import { spawn } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { descendants, signalTree } from './tree'

describe('descendants', () => {
  it('finds a process and everything it started, however deep', () => {
    const list = [
      '  1     0',
      '100     1',
      '101   100',
      '102   101',
      '103   101',
      '200     1',
      '201   200'
    ].join('\n')
    expect(descendants(100, list).sort()).toEqual([100, 101, 102, 103])
  })

  it('lists each process before those it started', () => {
    const list = ['100 1', '103 101', '101 100', '102 101', '104 103'].join('\n')
    const found = descendants(100, list)
    for (const [parent, child] of [[100, 101], [101, 102], [101, 103], [103, 104]]) {
      expect(found.indexOf(parent!), `${parent} before ${child}`).toBeLessThan(found.indexOf(child!))
    }
  })

  it('finds only the process itself when it started nothing', () => {
    expect(descendants(300, '300 1\n301 2')).toEqual([300])
  })
})

const started: number[] = []

afterEach(() => {
  for (const pid of started.splice(0)) {
    try {
      process.kill(pid, 'SIGCONT')
      process.kill(pid, 'SIGKILL')
    } catch {
      // Gone already.
    }
  }
})

function stateOf(pid: number): string {
  return execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).trim()
}

describe.skipIf(process.platform === 'win32')('signalTree', () => {
  it('stops a process and what it started, and lets them go on', async () => {
    const parent = spawn('/bin/sh', ['-c', 'sleep 30 & wait'], { stdio: 'ignore' })
    started.push(parent.pid!)
    await new Promise((resolve) => setTimeout(resolve, 300))
    const tree = descendants(parent.pid!)
    expect(tree.length).toBeGreaterThanOrEqual(2)
    started.push(...tree)

    signalTree(parent.pid!, 'SIGSTOP')
    for (const pid of tree) expect(stateOf(pid), `process ${pid}`).toMatch(/^T/)

    signalTree(parent.pid!, 'SIGCONT')
    for (const pid of tree) expect(stateOf(pid), `process ${pid}`).not.toMatch(/^T/)
  })

  it('does nothing to a process that is gone', () => {
    expect(() => signalTree(999_999, 'SIGSTOP')).not.toThrow()
  })
})
