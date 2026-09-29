import { execFile } from 'node:child_process'
import { programOf } from '@shared/launchers'
import type { Launcher } from '@shared/types'
import { posixShell } from './shell'

const TIMEOUT_MS = 5000
// The settings of a shell may print what they like, so the answer is marked.
const MARK = 'telegraph-found:'
const FIND = `for program in "$@"; do command -v -- "$program" >/dev/null 2>&1 && echo "${MARK}$program"; done`

export type Run = (file: string, args: string[], env: Record<string, string>) => Promise<string>

const runShell: Run = (file, args, env) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { timeout: TIMEOUT_MS, env }, (error, stdout) =>
      // A shell can find every program and still end badly, for reasons of its settings.
      error && !stdout.includes(MARK) ? reject(error) : resolve(stdout)
    )
  })

export function readFound(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith(MARK))
    .map((line) => line.slice(MARK.length))
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
  run: Run = runShell
): Promise<string[]> {
  const programs = [...new Set(launchers.flatMap((launcher) => programOf(launcher) ?? []))]
  if (programs.length === 0) return launchers.map((launcher) => launcher.id)

  const shell = posixShell(userShell)
  let found: Set<string>
  try {
    const output = await run(shell, ['-l', '-i', '-c', FIND, 'telegraph', ...programs], {
      ...env,
      SHELL: userShell || shell
    })
    found = new Set(readFound(output))
  } catch {
    return launchers.map((launcher) => launcher.id)
  }
  return launchers
    .filter((launcher) => {
      const program = programOf(launcher)
      return program === null || found.has(program)
    })
    .map((launcher) => launcher.id)
}
