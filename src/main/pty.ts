import { statSync } from 'node:fs'
import * as pty from 'node-pty'
import type { CreateSessionRequest } from '@shared/types'
import { buildSessionEnv, buildShellInvocation, shellName } from './shell'

// Output is collected for a frame before it crosses to the window, so a
// chatty process costs one message per frame instead of one per chunk.
const FLUSH_INTERVAL_MS = 8

interface Session {
  process: pty.IPty
  shell: string
  pending: string
  flushTimer: NodeJS.Timeout | null
}

export interface SessionEvents {
  onData(sessionId: string, data: string): void
  onExit(sessionId: string, exitCode: number): void
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
    const child = pty.spawn(invocation.file, invocation.args, {
      name: 'xterm-256color',
      cols: request.cols,
      rows: request.rows,
      cwd: request.cwd,
      env: invocation.env
    })

    const session: Session = {
      process: child,
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
    this.sessions.get(sessionId)?.process.kill()
  }

  killAll(): void {
    for (const session of this.sessions.values()) session.process.kill()
  }

  /** Name of what is running in front of the shell, or null when the shell is at its prompt. */
  foregroundProcess(sessionId: string): string | null {
    const session = this.sessions.get(sessionId)
    if (!session) return null
    const name = shellName(session.process.process)
    return name === shellName(session.shell) ? null : name
  }

  busySessionCount(): number {
    let count = 0
    for (const sessionId of this.sessions.keys()) {
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

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}
