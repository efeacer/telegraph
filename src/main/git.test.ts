import { describe, expect, it } from 'vitest'
import { parseGitStatus } from './git'

describe('parseGitStatus', () => {
  it('reads a clean branch that tracks a remote', () => {
    expect(parseGitStatus('## main...origin/main\n')).toEqual({ branch: 'main', changedFiles: 0 })
  })

  it('reads a branch that is ahead of its remote', () => {
    expect(parseGitStatus('## feature/x...origin/feature/x [ahead 2]\n')).toEqual({
      branch: 'feature/x',
      changedFiles: 0
    })
  })

  it('reads a branch without a remote', () => {
    expect(parseGitStatus('## local-only\n')).toEqual({ branch: 'local-only', changedFiles: 0 })
  })

  it('counts changed and untracked files', () => {
    const output = '## main\n M src/a.ts\nA  src/b.ts\n?? notes.md\n'
    expect(parseGitStatus(output)).toEqual({ branch: 'main', changedFiles: 3 })
  })

  it('reads a repository without commits', () => {
    expect(parseGitStatus('## No commits yet on main\n')).toEqual({
      branch: 'main',
      changedFiles: 0
    })
  })

  it('reports a detached HEAD as no branch', () => {
    expect(parseGitStatus('## HEAD (no branch)\n')).toEqual({ branch: null, changedFiles: 0 })
  })

  it('rejects output that is not a status', () => {
    expect(parseGitStatus('')).toBeNull()
    expect(parseGitStatus('fatal: not a git repository')).toBeNull()
  })
})
