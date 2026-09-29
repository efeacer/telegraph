import type { Launcher, Start } from './types'

export const SHELL_LAUNCHER_ID = 'shell'
export const CLAUDE_LAUNCHER_ID = 'claude'

const VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*=/

export const DEFAULT_LAUNCHERS: Launcher[] = [
  { id: SHELL_LAUNCHER_ID, name: 'Shell', command: null },
  {
    id: CLAUDE_LAUNCHER_ID,
    name: 'Claude',
    command: 'claude',
    modelFlag: '--model',
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
    ]
  },
  {
    id: 'codex',
    name: 'Codex',
    command: 'codex',
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
  const mode = launcher.modes?.find((candidate) => candidate.id === start.modeId)
  if (mode) parts.push(mode.args)
  return parts.join(' ')
}

/** The program a launcher runs, which has to be installed for it to work. */
export function programOf(launcher: Launcher): string | null {
  const words = launcher.command?.trim().split(/\s+/) ?? []
  return words.find((word) => word !== '' && !VARIABLE.test(word)) ?? null
}
