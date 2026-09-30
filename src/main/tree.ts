import { execFileSync } from 'node:child_process'

/** A process and every process it started, as `ps -axo pid=,ppid=` lists them: each before those it started. */
export function descendants(root: number, list = listProcesses()): number[] {
  const children = new Map<number, number[]>()
  for (const line of list.split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number)
    if (!pid || ppid === undefined || Number.isNaN(ppid)) continue
    children.set(ppid, [...(children.get(ppid) ?? []), pid])
  }
  const found: number[] = []
  const waiting = [root]
  while (waiting.length > 0) {
    const pid = waiting.shift()!
    if (found.includes(pid)) continue
    found.push(pid)
    waiting.push(...(children.get(pid) ?? []))
  }
  return found
}

function listProcesses(): string {
  return execFileSync('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
}

/**
 * Sends a signal to a process and every process it started: to freeze all of
 * a session, the agent and whatever it runs, and to let it go on.
 *
 * A shell that sees a program it runs stopped takes it for a job the user
 * suspended, as with Ctrl-Z, and takes the terminal back from it. So a shell
 * must never see that: each process is frozen before those it started, and
 * let go on after them.
 */
export function signalTree(root: number, signal: 'SIGSTOP' | 'SIGCONT'): void {
  let pids: number[]
  try {
    pids = descendants(root)
  } catch {
    pids = [root]
  }
  if (signal === 'SIGCONT') pids.reverse()
  for (const pid of pids) {
    try {
      process.kill(pid, signal)
    } catch {
      // Ended in the meantime.
    }
  }
}
