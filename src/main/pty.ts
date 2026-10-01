import { statSync } from 'node:fs'
import { delimiter } from 'node:path'
import * as pty from 'node-pty'
import type { CreateSessionRequest } from '@shared/types'
import { USAGE_FILE_VARIABLE } from '@shared/usage'
import { buildSessionEnv, buildShellInvocation, shellName } from './shell'
import { signalTree } from './tree'

// Output is collected for a frame before it crosses to the window, so a
// chatty process costs one message per frame instead of one per chunk.
const FLUSH_INTERVAL_MS = 8

interface Session {
  process: pty.IPty
  paused: boolean
  shell: string
  pending: string
  flushTimer: NodeJS.Timeout | null
}

export interface SessionEvents {
  onData(sessionId: string, data: string): void
  onExit(sessionId: string, exitCode: number): void
  /** The file the session is to report what it uses to, if there is one. */
  usageFileFor?(sessionId: string): string | null
  /** More for the environment of every session. A TELEGRAPH_BIN in it is put first on the PATH. */
  extraEnv?(): Record<string, string>
}

export class PtyManager {
  private readonly sessions = new Map<string, Session>()

  constructor(
    private readonly appVersion: string,
    private readonly events: SessionEvents
  ) {}

  create(request: CreateSessionRequest): void {
    if (this.sessions.has(request.sessionId)) {
      throw new Error(`Session ${request.sessionId} already exists`)
    }
    if (!isDirectory(request.cwd)) {
      throw new Error(`The folder ${request.cwd} does not exist`)
    }

    const invocation = buildShellInvocation(
      process.env.SHELL,
      request.command,
      buildSessionEnv(process.env, this.appVersion)
    )
    const usageFile = this.events.usageFileFor?.(request.sessionId)
    const child = pty.spawn(invocation.file, invocation.args, {
      name: 'xterm-256color',
      cols: request.cols,
      rows: request.rows,
      cwd: request.cwd,
      env: withExtras(invocation.env, usageFile, this.events.extraEnv?.() ?? {})
    })

    const session: Session = {
      process: child,
      paused: false,
      shell: invocation.env.SHELL!,
      pending: '',
      flushTimer: null
    }
    this.sessions.set(request.sessionId, session)

    child.onData((data) => {
      session.pending += data
      session.flushTimer ??= setTimeout(() => this.flush(request.sessionId), FLUSH_INTERVAL_MS)
    })
    child.onExit(({ exitCode }) => {
      this.flush(request.sessionId)
      this.sessions.delete(request.sessionId)
      this.events.onExit(request.sessionId, exitCode)
    })
  }

  write(sessionId: string, data: string): void {
    this.sessions.get(sessionId)?.process.write(data)
  }

  resize(sessionId: string, cols: number, rows: number): void {
    if (cols < 1 || rows < 1) return
    this.sessions.get(sessionId)?.process.resize(cols, rows)
  }

  kill(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    // A frozen process cannot end until it is let go on.
    if (session.paused) this.resume(sessionId)
    session.process.kill()
  }

  killAll(): void {
    for (const sessionId of [...this.sessions.keys()]) this.kill(sessionId)
  }

  /** Freezes a session where it is: the program and whatever it runs. False where that cannot be done. */
  pause(sessionId: string): boolean {
    const session = this.sessions.get(sessionId)
    if (!session || process.platform === 'win32') return false
    signalTree(session.process.pid, 'SIGSTOP')
    session.paused = true
    return true
  }

  resume(sessionId: string): boolean {
    const session = this.sessions.get(sessionId)
    if (!session || process.platform === 'win32') return false
    signalTree(session.process.pid, 'SIGCONT')
    session.paused = false
    return true
  }

  /** Name of what is running in front of the shell, or null when the shell is at its prompt. */
  foregroundProcess(sessionId: string): string | null {
    const session = this.sessions.get(sessionId)
    if (!session) return null
    const name = shellName(session.process.process)
    return name === shellName(session.shell) ? null : name
  }

  /** How many of the sessions, all of them unless they are named, have a program running in front of the shell. */
  busySessionCount(sessionIds: Iterable<string> = this.sessions.keys()): number {
    let count = 0
    for (const sessionId of sessionIds) {
      if (this.foregroundProcess(sessionId) !== null) count++
    }
    return count
  }

  private flush(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    if (session.flushTimer) clearTimeout(session.flushTimer)
    session.flushTimer = null
    if (session.pending.length === 0) return
    const data = session.pending
    session.pending = ''
    this.events.onData(sessionId, data)
  }
}

function withExtras(
  env: Record<string, string>,
  usageFile: string | null | undefined,
  extras: Record<string, string>
): Record<string, string> {
  const joined: Record<string, string> = { ...env, ...extras }
  if (usageFile) joined[USAGE_FILE_VARIABLE] = usageFile
  // The telegraph command is found before any other of the name.
  if (extras.TELEGRAPH_BIN) joined.PATH = [extras.TELEGRAPH_BIN, env.PATH].filter(Boolean).join(delimiter)
  return joined
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}
