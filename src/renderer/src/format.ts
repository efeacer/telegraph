import type { GitStatus } from '@shared/types'

export function describeGit(git: GitStatus): string {
  const branch = git.branch ?? 'detached'
  return git.changedFiles === 0 ? branch : `${branch}, ${git.changedFiles} changed`
}

export function shortenPath(path: string): string {
  return path.replace(/^\/Users\/[^/]+/, '~')
}
