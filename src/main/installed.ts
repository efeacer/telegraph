import { spawn } from 'node:child_process'
import { programOf } from '@shared/launchers'
import type { Launcher } from '@shared/types'
import { posixShell } from './shell'

const TIMEOUT_MS = 5000
// The settings of a shell may print what they like, so the answers are marked
// and each starts a line of its own. The last mark says the shell got to the
// end, which its exit status does not: that is the status of the last search.
const FOUND = 'telegraph-found:'
const DONE = 'telegraph-done'
const FIND = [
  'for program in "$@"; do',
  `command -v -- "$program" >/dev/null 2>&1 && printf '\\n${FOUND}%s\\n' "$program";`,
  'done;',
  `printf '\\n${DONE}\\n'`
].join(' ')

export type Run = (file: string, args: string[], env: Record<string, string>) => Promise<string>

/**
 * Runs a shell and resolves to what it printed. The shell gets nothing to
 * read, so settings that ask a question go on without an answer, and it is
 * not waited for longer than it takes to answer or than the time given.
 */
export function shellRunner(timeoutMs = TIMEOUT_MS): Run {
  return (file, args, env) =>
    new Promise((resolve, reject) => {
      const child = spawn(file, args, { env, stdio: ['ignore', 'pipe', 'ignore'] })
      let output = ''

      const finish = (settle: () => void): void => {
        clearTimeout(timer)
        child.stdout.destroy()
        // Shells that read the user's settings do not end when asked nicely.
        child.kill('SIGKILL')
        settle()
      }
      const timer = setTimeout(
        () => finish(() => reject(new Error(`${file} did not answer in time`))),
        timeoutMs
      )

      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (text: string) => {
        output += text
        // What the settings left running may hold the output open long after.
        if (readFound(output) !== null) finish(() => resolve(output))
      })
      child.on('error', (error) => finish(() => reject(error)))
      child.on('close', () => finish(() => resolve(output)))
    })
}

/** The programs the shell found, or null if it did not get to the end of looking. */
export function readFound(output: string): string[] | null {
  const lines = output.split('\n').map((line) => line.trim())
  if (!lines.includes(DONE)) return null
  return lines.filter((line) => line.startsWith(FOUND)).map((line) => line.slice(FOUND.length))
}

/**
 * The ids of the launchers that can be started. Programs are looked for the
 * way a session would find them: by a login shell that reads the user's
 * settings. When the shell cannot be asked, every launcher is offered.
 */
export async function findInstalled(
  launchers: Launcher[],
  userShell: string | undefined,
  env: Record<string, string>,
  run: Run = shellRunner()
): Promise<string[]> {
  const everyone = launchers.map((launcher) => launcher.id)
  const programs = [...new Set(launchers.flatMap((launcher) => programOf(launcher) ?? []))]
  if (programs.length === 0) return everyone

  const shell = posixShell(userShell)
  let found: string[] | null
  try {
    const output = await run(shell, ['-l', '-i', '-c', FIND, 'telegraph', ...programs], {
      ...env,
      SHELL: userShell || shell
    })
    found = readFound(output)
  } catch {
    found = null
  }
  if (found === null) return everyone

  return launchers
    .filter((launcher) => {
      const program = programOf(launcher)
      return program === null || found.includes(program)
    })
    .map((launcher) => launcher.id)
}
