import type { Launcher, Start } from './types'

export const SHELL_LAUNCHER_ID = 'shell'
export const CLAUDE_LAUNCHER_ID = 'claude'

const VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*=/
// A name or a path, with nothing in it that a shell would make something else of.
const PLAIN = /^[A-Za-z0-9._+/-]+$/

export const DEFAULT_LAUNCHERS: Launcher[] = [
  { id: SHELL_LAUNCHER_ID, name: 'Shell', command: null },
  {
    id: CLAUDE_LAUNCHER_ID,
    name: 'Claude',
    command: 'claude',
    interruptKey: '\u001b',
    modelFlag: '--model',
    modelCommand: '/model',
    renameCommand: '/rename',
    // Claude reads a file or folder that is mentioned, @path, into the chat.
    attachAs: 'mention',
    providers: ['anthropic'],
    // Names that stand for the latest model of a kind, so they do not go out of date.
    models: [
      { id: 'fable', name: 'Latest Fable' },
      { id: 'opus', name: 'Latest Opus' },
      { id: 'sonnet', name: 'Latest Sonnet' },
      { id: 'haiku', name: 'Latest Haiku' }
    ],
    modes: [
      { id: 'continue', name: 'continue the last chat', args: '--continue' },
      { id: 'resume', name: 'pick a chat to resume', args: '--resume' }
    ],
    chats: { kind: 'claude', flag: '--resume' },
    reports: { kind: 'claude' }
  },
  {
    id: 'codex',
    name: 'Codex',
    command: 'codex',
    interruptKey: '\u001b',
    modelFlag: '--model',
    providers: ['openai'],
    models: [],
    modes: [
      { id: 'continue', name: 'continue the last chat', args: 'resume --last' },
      { id: 'resume', name: 'pick a chat to resume', args: 'resume' }
    ]
  },
  {
    id: 'gemini',
    name: 'Gemini',
    command: 'gemini',
    interruptKey: '\u001b',
    modelFlag: '--model',
    providers: ['google'],
    models: [
      { id: 'pro', name: 'Latest Pro' },
      { id: 'flash', name: 'Latest Flash' },
      { id: 'flash-lite', name: 'Latest Flash-Lite' }
    ],
    modes: [{ id: 'continue', name: 'continue the last chat', args: '--resume latest' }]
  }
]

/** Makes one word of any text, whatever a shell would otherwise read into it. */
export function quote(text: string): string {
  return `'${text.replaceAll("'", "'\\''")}'`
}

/**
 * The command that starts the launcher, or null for a plain shell. The model
 * goes before the arguments of the mode, because programs with subcommands
 * take their own options first.
 */
export function composeCommand(launcher: Launcher, start: Start): string | null {
  if (launcher.command === null) return null
  const parts = [launcher.command]
  const model = start.model?.trim()
  if (launcher.modelFlag && model) parts.push(launcher.modelFlag, quote(model))
  const chatId = start.chatId?.trim()
  const mode = launcher.modes?.find((candidate) => candidate.id === start.modeId)
  if (launcher.chats && chatId) parts.push(launcher.chats.flag, quote(chatId))
  else if (mode) parts.push(mode.args)
  return parts.join(' ')
}

/**
 * The program a launcher runs, which has to be installed for it to work.
 * Null where there is none, or where only a shell could say what it is.
 */
export function programOf(launcher: Launcher): string | null {
  const words = launcher.command?.trim().split(/\s+/) ?? []
  const program = words.find((word) => word !== '' && !VARIABLE.test(word))
  return program !== undefined && PLAIN.test(program) ? program : null
}
