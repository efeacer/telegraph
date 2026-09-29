import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Launcher } from '@shared/types'
import { findInstalled, readFound, shellRunner, type Run } from './installed'

const LAUNCHERS: Launcher[] = [
  { id: 'shell', name: 'Shell', command: null },
  { id: 'claude', name: 'Claude', command: 'claude' },
  { id: 'claude-loud', name: 'Claude, loud', command: 'claude --verbose' },
  { id: 'codex', name: 'Codex', command: 'codex' }
]

function finding(...programs: string[]): Run {
  return async () =>
    [...programs.map((program) => `telegraph-found:${program}`), 'telegraph-done'].join('\n')
}

describe('readFound', () => {
  it('reads the programs the shell has found', () => {
    const output = 'telegraph-found:claude\ntelegraph-found:codex\ntelegraph-done\n'
    expect(readFound(output)).toEqual(['claude', 'codex'])
  })

  it('reads past what the settings of the shell print', () => {
    const output =
      'Welcome back!\n\x1b[32mtelegraph-found:not this\x1b[0m\ntelegraph-found:claude\r\ntelegraph-done\r\n'
    expect(readFound(output)).toEqual(['claude'])
  })

  it('reads that nothing was found', () => {
    expect(readFound('\ntelegraph-done\n')).toEqual([])
  })

  it('reads nothing from a shell that did not get to the end', () => {
    expect(readFound('telegraph-found:claude\n')).toBeNull()
    expect(readFound('')).toBeNull()
  })
})

describe('findInstalled', () => {
  it('offers the launchers whose program was found', async () => {
    expect(await findInstalled(LAUNCHERS, '/bin/zsh', {}, finding('claude'))).toEqual([
      'shell',
      'claude',
      'claude-loud'
    ])
  })

  it('always offers the shell', async () => {
    expect(await findInstalled(LAUNCHERS, '/bin/zsh', {}, finding())).toEqual(['shell'])
  })

  it('offers every launcher when the shell cannot be asked', async () => {
    const failing: Run = async () => {
      throw new Error('timed out')
    }
    expect(await findInstalled(LAUNCHERS, '/bin/zsh', {}, failing)).toEqual([
      'shell',
      'claude',
      'claude-loud',
      'codex'
    ])
  })

  it('offers every launcher when the shell did not get to the end', async () => {
    const cutShort: Run = async () => 'telegraph-found:claude\n'
    expect(await findInstalled(LAUNCHERS, '/bin/zsh', {}, cutShort)).toHaveLength(4)
  })

  it('offers a launcher whose program it cannot make out', async () => {
    const launchers: Launcher[] = [
      { id: 'home', name: 'Home', command: '~/bin/agent --fast' },
      { id: 'quoted', name: 'Quoted', command: '"/Applications/My Agent/agent"' },
      { id: 'nested', name: 'Nested', command: '(cd sub && claude)' },
      { id: 'codex', name: 'Codex', command: 'codex' }
    ]
    expect(await findInstalled(launchers, '/bin/zsh', {}, finding())).toEqual([
      'home',
      'quoted',
      'nested'
    ])
  })

  it('asks the shell of the user, the way a session would', async () => {
    const asked: unknown[][] = []
    const run: Run = async (...call) => {
      asked.push(call)
      return ''
    }
    await findInstalled(LAUNCHERS, '/opt/homebrew/bin/bash', { PATH: '/bin' }, run)

    expect(asked).toEqual([
      [
        '/opt/homebrew/bin/bash',
        ['-l', '-i', '-c', expect.stringContaining('command -v'), 'telegraph', 'claude', 'codex'],
        { PATH: '/bin', SHELL: '/opt/homebrew/bin/bash' }
      ]
    ])
  })

  it('asks a shell that understands the question', async () => {
    let file = ''
    const run: Run = async (asked) => {
      file = asked
      return ''
    }
    await findInstalled(LAUNCHERS, '/opt/homebrew/bin/fish', {}, run)
    expect(file).toBe('/bin/zsh')
  })

  it('does not ask when only the shell is there to start', async () => {
    let asked = false
    const run: Run = async () => {
      asked = true
      return ''
    }
    expect(await findInstalled([LAUNCHERS[0]!], '/bin/zsh', {}, run)).toEqual(['shell'])
    expect(asked).toBe(false)
  })
})

describe('asking a real shell', () => {
  const launchers: Launcher[] = [
    { id: 'shell', name: 'Shell', command: null },
    { id: 'lister', name: 'Lister', command: 'ls -l' },
    { id: 'missing', name: 'Missing', command: 'telegraph-no-such-program' }
  ]
  let home: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'telegraph-home-'))
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  function ask(candidates: Launcher[], timeoutMs = 5000): Promise<string[]> {
    const env = { HOME: home, PATH: '/usr/bin:/bin' }
    return findInstalled(candidates, '/bin/sh', env, shellRunner(timeoutMs))
  }

  it('finds the programs that are there', async () => {
    expect(await ask(launchers)).toEqual(['shell', 'lister'])
  })

  it('finds that none of the programs is there', async () => {
    expect(await ask([launchers[0]!, launchers[2]!])).toEqual(['shell'])
  })

  it('gets past settings that ask a question', async () => {
    writeFileSync(join(home, '.profile'), 'printf "Continue? [y/n] "\nread -r answer\n')
    expect(await ask(launchers)).toEqual(['shell', 'lister'])
  })

  it('gets past settings that print without ending the line', async () => {
    writeFileSync(join(home, '.profile'), "printf '\\033]0;title\\007'\n")
    expect(await ask(launchers)).toEqual(['shell', 'lister'])
  })

  it('does not wait for what the settings leave running', async () => {
    writeFileSync(join(home, '.profile'), '(sleep 20 &)\n')
    const before = Date.now()
    expect(await ask(launchers)).toEqual(['shell', 'lister'])
    expect(Date.now() - before).toBeLessThan(3000)
  })

  it('gives up on a shell that takes too long', async () => {
    writeFileSync(join(home, '.profile'), 'sleep 20\n')
    const before = Date.now()
    expect(await ask(launchers, 300)).toEqual(['shell', 'lister', 'missing'])
    expect(Date.now() - before).toBeLessThan(3000)
  })
})
