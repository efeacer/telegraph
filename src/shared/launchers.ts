import type { Launcher } from './types'

export const SHELL_LAUNCHER_ID = 'shell'
export const CLAUDE_LAUNCHER_ID = 'claude'

export const DEFAULT_LAUNCHERS: Launcher[] = [
  { id: SHELL_LAUNCHER_ID, name: 'Shell', command: null },
  { id: CLAUDE_LAUNCHER_ID, name: 'Claude', command: 'claude' },
  { id: 'claude-continue', name: 'Claude, continue last chat', command: 'claude --continue' },
  { id: 'claude-resume', name: 'Claude, pick a chat to resume', command: 'claude --resume' }
]
