import { randomBytes, timingSafeEqual } from 'node:crypto'
import { chmodSync, rmSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Meeting } from '@shared/agenda'
import type { MailMessage } from './google/api'

const MOST_REQUEST = 16 * 1024
// The length of a path a socket may have is short on some systems.
const MOST_SOCKET_PATH = 100
const DAY_MS = 24 * 60 * 60_000

export interface BridgeHandlers {
  status(): Promise<Record<string, unknown>>
  meetings(days: number): Promise<Meeting[]>
  searchMail(query: string, most: number): Promise<MailMessage[]>
  readMail(id: string): Promise<MailMessage | null>
}

export function socketPathFor(directory: string): string {
  if (process.platform === 'win32') return `\\\\.\\pipe\\telegraph-${randomBytes(6).toString('hex')}`
  const path = join(directory, 'bridge.sock')
  return path.length <= MOST_SOCKET_PATH ? path : join(tmpdir(), `telegraph-${randomBytes(6).toString('hex')}.sock`)
}

/**
 * Where the telegraph command, run by any agent in a session, asks Telegraph
 * for what it knows. The keys to the user's accounts stay in Telegraph: the
 * command only gets answers. It is answered only with the key given to the
 * sessions of this run of Telegraph.
 */
export class Bridge {
  readonly token = randomBytes(24).toString('base64url')
  readonly socketPath: string
  private server: Server | null = null

  constructor(private readonly options: { socketPath: string; handlers: BridgeHandlers }) {
    this.socketPath = options.socketPath
  }

  async listen(): Promise<void> {
    if (process.platform !== 'win32') rmSync(this.socketPath, { force: true })
    this.server = createServer((socket) => this.serve(socket))
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject)
      this.server!.listen(this.socketPath, resolve)
    })
    if (process.platform !== 'win32') chmodSync(this.socketPath, 0o600)
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()))
    this.server = null
    if (process.platform !== 'win32') rmSync(this.socketPath, { force: true })
  }

  private serve(socket: Socket): void {
    let request = ''
    socket.setEncoding('utf8')
    socket.on('error', () => {})
    socket.on('data', (text: string) => {
      request += text
      if (request.length > MOST_REQUEST) return this.reply(socket, { ok: false, error: 'The question is too long.' })
      const end = request.indexOf('\n')
      if (end !== -1) void this.answer(request.slice(0, end)).then((answer) => this.reply(socket, answer))
    })
  }

  private reply(socket: Socket, answer: Record<string, unknown>): void {
    if (socket.writable) socket.end(`${JSON.stringify(answer)}\n`)
  }

  private allowed(token: unknown): boolean {
    if (typeof token !== 'string') return false
    const given = Buffer.from(token)
    const own = Buffer.from(this.token)
    return given.length === own.length && timingSafeEqual(given, own)
  }

  private async answer(line: string): Promise<Record<string, unknown>> {
    let asked: Record<string, unknown>
    try {
      asked = JSON.parse(line) as Record<string, unknown>
    } catch {
      return { ok: false, error: 'The question could not be read.' }
    }
    if (!this.allowed(asked.token)) return { ok: false, error: 'Not allowed: this is not a session of this Telegraph.' }
    const args = (typeof asked.args === 'object' && asked.args !== null ? asked.args : {}) as Record<string, unknown>
    const number = (value: unknown, fallback: number, most: number): number =>
      typeof value === 'number' && Number.isInteger(value) && value > 0 ? Math.min(value, most) : fallback
    const { handlers } = this.options
    try {
      switch (asked.command) {
        case 'status':
          return { ok: true, result: await handlers.status() }
        case 'meetings':
          return { ok: true, result: await handlers.meetings(number(args.days, 2, 14)) }
        case 'mail-search':
          if (typeof args.query !== 'string' || args.query.trim() === '') return { ok: false, error: 'Say what to look for.' }
          return { ok: true, result: await handlers.searchMail(args.query.slice(0, 500), number(args.most, 10, 20)) }
        case 'mail-read':
          if (typeof args.id !== 'string') return { ok: false, error: 'Say which message to read.' }
          return { ok: true, result: await handlers.readMail(args.id) }
        default:
          return { ok: false, error: 'Unknown question.' }
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
}

export { DAY_MS }
