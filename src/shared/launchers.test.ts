import { describe, expect, it } from 'vitest'
import { DEFAULT_LAUNCHERS, composeCommand, programOf, quote } from './launchers'
import type { Launcher } from './types'

const claude: Launcher = {
  id: 'claude',
  name: 'Claude',
  command: 'claude',
  modelFlag: '--model',
  modes: [
    { id: 'continue', name: 'continue last chat', args: '--continue' },
    { id: 'resume', name: 'pick a chat to resume', args: '--resume' }
  ]
}

const codex: Launcher = {
  id: 'codex',
  name: 'Codex',
  command: 'codex',
  modelFlag: '--model',
  modes: [{ id: 'continue', name: 'continue last chat', args: 'resume --last' }]
}

describe('composeCommand', () => {
  it('starts a plain shell with no command at all', () => {
    const shell: Launcher = { id: 'shell', name: 'Shell', command: null }
    expect(composeCommand(shell, { model: 'opus', modeId: null })).toBeNull()
  })

  it('runs the command as it is when nothing was chosen', () => {
    expect(composeCommand(claude, { model: null, modeId: null })).toBe('claude')
  })

  it('passes the model that was chosen', () => {
    expect(composeCommand(claude, { model: 'claude-opus-5-5', modeId: null })).toBe(
      "claude --model 'claude-opus-5-5'"
    )
  })

  it('adds the arguments of the mode', () => {
    expect(composeCommand(claude, { model: null, modeId: 'resume' })).toBe('claude --resume')
  })

  it('puts the model before a subcommand', () => {
    expect(composeCommand(codex, { model: 'gpt-6-sol', modeId: 'continue' })).toBe(
      "codex --model 'gpt-6-sol' resume --last"
    )
  })

  it('opens a chat that was had before', () => {
    const remembering = { ...claude, chats: { kind: 'claude' as const, flag: '--resume' } }
    const chatId = '11111111-1111-4111-8111-111111111111'
    expect(composeCommand(remembering, { model: 'opus', modeId: null, chatId })).toBe(
      "claude --model 'opus' --resume '11111111-1111-4111-8111-111111111111'"
    )
  })

  it('opens the chat and leaves the mode be, when both are asked for', () => {
    const remembering = { ...claude, chats: { kind: 'claude' as const, flag: '--resume' } }
    expect(composeCommand(remembering, { model: null, modeId: 'continue', chatId: 'abc' })).toBe(
      "claude --resume 'abc'"
    )
  })

  it('opens no chat with a launcher that keeps none', () => {
    expect(composeCommand(claude, { model: null, modeId: null, chatId: 'abc' })).toBe('claude')
  })

  it('keeps a chat from being read as a command', () => {
    const remembering = { ...claude, chats: { kind: 'claude' as const, flag: '--resume' } }
    expect(composeCommand(remembering, { model: null, modeId: null, chatId: 'x; rm -rf ~' })).toBe(
      "claude --resume 'x; rm -rf ~'"
    )
  })

  it('passes no model to a launcher that cannot take one', () => {
    const greeter: Launcher = { id: 'greeter', name: 'Greeter', command: 'echo hello' }
    expect(composeCommand(greeter, { model: 'opus', modeId: null })).toBe('echo hello')
  })

  it('ignores a mode the launcher does not have', () => {
    expect(composeCommand(claude, { model: null, modeId: 'gone' })).toBe('claude')
  })

  it('ignores a model that is only spaces', () => {
    expect(composeCommand(claude, { model: '   ', modeId: null })).toBe('claude')
  })

  it('keeps a model from being read as a command', () => {
    expect(composeCommand(claude, { model: 'opus; rm -rf ~', modeId: null })).toBe(
      "claude --model 'opus; rm -rf ~'"
    )
    expect(composeCommand(claude, { model: "o'; rm -rf ~; '", modeId: null })).toBe(
      "claude --model 'o'\\''; rm -rf ~; '\\'''"
    )
  })
})

describe('quote', () => {
  it('makes one word of any text', () => {
    expect(quote('$(whoami) `id` "x"')).toBe('\'$(whoami) `id` "x"\'')
  })
})

describe('programOf', () => {
  it('is the first word of the command', () => {
    expect(programOf({ id: 'a', name: 'A', command: 'claude --verbose' })).toBe('claude')
  })

  it('skips variables set in front of the program', () => {
    expect(programOf({ id: 'a', name: 'A', command: 'DEBUG=1 FOO=bar codex' })).toBe('codex')
  })

  it('is nothing for a plain shell', () => {
    expect(programOf({ id: 'shell', name: 'Shell', command: null })).toBeNull()
  })

  it('can be a path', () => {
    expect(programOf({ id: 'a', name: 'A', command: '/opt/homebrew/bin/codex -m x' })).toBe(
      '/opt/homebrew/bin/codex'
    )
  })

  it('is nothing where only a shell could say what runs', () => {
    for (const command of ['~/bin/agent', '$HOME/bin/agent', '"/bin/ls" -l', '(cd sub && claude)']) {
      expect(programOf({ id: 'a', name: 'A', command }), command).toBeNull()
    }
  })

  it('is nothing for an empty command', () => {
    expect(programOf({ id: 'a', name: 'A', command: '   ' })).toBeNull()
  })
})

describe('the launchers Telegraph comes with', () => {
  it('start with the shell', () => {
    expect(DEFAULT_LAUNCHERS[0]).toEqual({ id: 'shell', name: 'Shell', command: null })
  })

  it('have ids of their own', () => {
    const ids = DEFAULT_LAUNCHERS.map((launcher) => launcher.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('know that Claude can report its limits', () => {
    const claudeLauncher = DEFAULT_LAUNCHERS.find((launcher) => launcher.id === 'claude')
    expect(claudeLauncher?.reports).toEqual({ kind: 'claude' })
  })

  it('know how Claude keeps its chats', () => {
    const claudeLauncher = DEFAULT_LAUNCHERS.find((launcher) => launcher.id === 'claude')
    expect(claudeLauncher?.chats).toEqual({ kind: 'claude', flag: '--resume' })
  })

  it('name a provider wherever a model can be chosen', () => {
    for (const launcher of DEFAULT_LAUNCHERS.filter((candidate) => candidate.modelFlag)) {
      expect(launcher.providers?.length, launcher.name).toBeGreaterThan(0)
    }
  })
})
