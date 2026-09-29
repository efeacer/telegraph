import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { buildSessionEnv, buildShellInvocation, shellName } from './shell'

describe('buildSessionEnv', () => {
  it('removes variables that belong to the process Telegraph started from', () => {
    const env = buildSessionEnv(
      {
        PATH: '/usr/bin',
        CLAUDECODE: '1',
        CLAUDE_CODE_ENTRYPOINT: 'cli',
        ELECTRON_RUN_AS_NODE: '1',
        npm_config_prefix: '/somewhere',
        NODE_ENV: 'development',
        TELEGRAPH_USER_DATA: '/tmp/x'
      },
      '1.2.3'
    )
    expect(Object.keys(env).sort()).toEqual(
      ['COLORTERM', 'LANG', 'PATH', 'TERM', 'TERM_PROGRAM', 'TERM_PROGRAM_VERSION'].sort()
    )
  })

  it('describes the terminal', () => {
    const env = buildSessionEnv({ TERM: 'dumb' }, '1.2.3')
    expect(env).toMatchObject({
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      TERM_PROGRAM: 'Telegraph',
      TERM_PROGRAM_VERSION: '1.2.3'
    })
  })

  it('keeps an existing locale', () => {
    expect(buildSessionEnv({ LANG: 'tr_TR.UTF-8' }, '1').LANG).toBe('tr_TR.UTF-8')
  })

  it('skips undefined values', () => {
    expect('MISSING' in buildSessionEnv({ MISSING: undefined }, '1')).toBe(false)
  })
})

describe('buildShellInvocation', () => {
  it('starts a login shell when there is no command', () => {
    expect(buildShellInvocation('/bin/bash', null, { A: '1' })).toEqual({
      file: '/bin/bash',
      args: ['-l'],
      env: { A: '1', SHELL: '/bin/bash' }
    })
  })

  it('falls back to zsh when the shell is unknown', () => {
    expect(buildShellInvocation(undefined, null, {}).file).toBe('/bin/zsh')
  })

  it('passes the command in the environment instead of the arguments', () => {
    const invocation = buildShellInvocation('/bin/zsh', 'claude --continue', {})
    expect(invocation.file).toBe('/bin/zsh')
    expect(invocation.args.slice(0, 3)).toEqual(['-l', '-i', '-c'])
    expect(invocation.args.join(' ')).not.toContain('claude')
    expect(invocation.env.TELEGRAPH_COMMAND).toBe('claude --continue')
  })

  it('runs commands through zsh for shells that are not POSIX', () => {
    const invocation = buildShellInvocation('/opt/homebrew/bin/fish', 'claude', {})
    expect(invocation.file).toBe('/bin/zsh')
    expect(invocation.env.SHELL).toBe('/opt/homebrew/bin/fish')
  })

  it('runs the command without leaking it, then hands over to the shell', () => {
    const command = `printf '%s|' "it's" "$TELEGRAPH_COMMAND"`
    const invocation = buildShellInvocation('/bin/sh', command, { PATH: '/usr/bin:/bin' })
    // A stand-in for the user's shell, so the final exec is observable.
    const env = { ...invocation.env, SHELL: '/bin/echo' }
    const script = invocation.args.at(-1)!
    const output = execFileSync('/bin/sh', ['-c', script], { env, encoding: 'utf8' })
    expect(output).toBe("it's||-l\n")
  })
})

describe('shellName', () => {
  it('reads the name from a path', () => {
    expect(shellName('/bin/zsh')).toBe('zsh')
  })

  it('reads the name from a login shell title', () => {
    expect(shellName('-zsh')).toBe('zsh')
  })
})
