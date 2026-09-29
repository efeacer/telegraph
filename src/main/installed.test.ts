import { describe, expect, it } from 'vitest'
import type { Launcher } from '@shared/types'
import { findInstalled, readFound, type Run } from './installed'

const LAUNCHERS: Launcher[] = [
  { id: 'shell', name: 'Shell', command: null },
  { id: 'claude', name: 'Claude', command: 'claude' },
  { id: 'claude-loud', name: 'Claude, loud', command: 'claude --verbose' },
  { id: 'codex', name: 'Codex', command: 'codex' }
]

function finding(...programs: string[]): Run {
  return async () => programs.map((program) => `telegraph-found:${program}`).join('\n')
}

describe('readFound', () => {
  it('reads the programs the shell has found', () => {
    expect(readFound('telegraph-found:claude\ntelegraph-found:codex\n')).toEqual(['claude', 'codex'])
  })

  it('reads past what the settings of the shell print', () => {
    const output = 'Welcome back!\n\x1b[32mtelegraph-found:not this\x1b[0m\ntelegraph-found:claude\r\n'
    expect(readFound(output)).toEqual(['claude'])
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
