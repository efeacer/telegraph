import { basename } from 'node:path'

const FALLBACK_SHELL = '/bin/zsh'
const POSIX_SHELLS = new Set(['zsh', 'bash', 'sh', 'dash', 'ksh'])

// Variables that describe the process Telegraph was started from rather than
// the user's environment. Leaking them confuses tools started in a session:
// an agent would think it is nested inside another agent, npm would inherit
// the prefix of the dev script, and so on.
const STRIPPED_PREFIXES = ['ELECTRON_', 'CLAUDE_CODE_', 'npm_', 'VITE_', 'TELEGRAPH_']
const STRIPPED_KEYS = new Set(['CLAUDECODE', 'NODE_ENV', 'NODE_ENV_ELECTRON_VITE', 'INIT_CWD'])

const COMMAND_VARIABLE = 'TELEGRAPH_COMMAND'

// Runs the launcher's command, then drops into a login shell so the session
// outlives the agent. The command travels in a variable to avoid quoting it.
const RUN_THEN_SHELL = [
  `telegraph_command="$${COMMAND_VARIABLE}"`,
  `unset ${COMMAND_VARIABLE}`,
  'eval "$telegraph_command"',
  'unset telegraph_command',
  'exec "$SHELL" -l'
].join('; ')

export interface ShellInvocation {
  file: string
  args: string[]
  env: Record<string, string>
}

export function buildSessionEnv(
  base: Record<string, string | undefined>,
  appVersion: string
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) continue
    if (STRIPPED_KEYS.has(key)) continue
    if (STRIPPED_PREFIXES.some((prefix) => key.startsWith(prefix))) continue
    env[key] = value
  }
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  env.TERM_PROGRAM = 'Telegraph'
  env.TERM_PROGRAM_VERSION = appVersion
  // Apps started from Finder have no locale, which breaks non-ASCII output.
  env.LANG ??= 'en_US.UTF-8'
  return env
}

export function buildShellInvocation(
  userShell: string | undefined,
  command: string | null,
  env: Record<string, string>
): ShellInvocation {
  const shell = userShell || FALLBACK_SHELL
  const sessionEnv = { ...env, SHELL: shell }
  if (command === null) return { file: shell, args: ['-l'], env: sessionEnv }

  // The wrapper script is POSIX syntax, so shells like fish only take over
  // once the command has finished.
  const runner = POSIX_SHELLS.has(shellName(shell)) ? shell : FALLBACK_SHELL
  return {
    file: runner,
    args: ['-l', '-i', '-c', RUN_THEN_SHELL],
    env: { ...sessionEnv, [COMMAND_VARIABLE]: command }
  }
}

/** Name of a shell as it appears in a process list, where login shells start with a dash. */
export function shellName(shellPathOrTitle: string): string {
  return basename(shellPathOrTitle).replace(/^-/, '')
}
