import { execFile } from 'node:child_process'
import type { GitStatus } from '@shared/types'

const TIMEOUT_MS = 3000

/** Parses the output of `git status --porcelain=v1 --branch`. */
export function parseGitStatus(output: string): GitStatus | null {
  const lines = output.split('\n').filter((line) => line.length > 0)
  const header = lines[0]
  if (!header?.startsWith('## ')) return null
  return {
    branch: parseBranch(header.slice(3)),
    changedFiles: lines.length - 1
  }
}

function parseBranch(header: string): string | null {
  if (header.startsWith('HEAD (no branch)')) return null
  const unborn = /^No commits yet on (.+)$/.exec(header)
  if (unborn) return unborn[1]!
  // "main...origin/main [ahead 1]" or just "main"
  return header.split('...')[0]!.split(' ')[0]!
}

/** Resolves to null when the folder is not a git repository or git is unavailable. */
export function readGitStatus(projectPath: string): Promise<GitStatus | null> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-C', projectPath, 'status', '--porcelain=v1', '--branch'],
      { timeout: TIMEOUT_MS, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } },
      (error, stdout) => resolve(error ? null : parseGitStatus(stdout))
    )
  })
}
