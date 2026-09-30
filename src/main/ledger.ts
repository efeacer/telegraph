import { open, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { DayTokens, Tokens } from '@shared/types'

const DAYS = 7
// Records of chats lie two folders deep, those of the helpers of an agent four.
const DEPTH = 4
const ENDING = '.jsonl'
const NEW_LINE = 0x0a
// A record can be of any length. It is read a piece at a time, so that no more of it is held than that.
const CHUNK_BYTES = 4 * 1024 * 1024

export interface LedgerOptions {
  /** Where Claude Code keeps what it knows, which is `.claude` in the home folder unless it was moved. */
  configDir: string
  now?: () => Date
  /** For how long what was read is given again without reading. Sessions report several times a second. */
  freshForMs?: number
  chunkBytes?: number
}

interface Answer {
  at: number
  model: string
  tokens: Tokens
}

/** How far a record has been read, and which file that was. */
interface Place {
  file: number
  offset: number
}

/**
 * What the answers of the last week took, read from the records Claude Code
 * keeps of every chat on this machine. The records grow while chats go on, so
 * each is read on from where the ledger last was. They are not Telegraph's
 * to rely on: what cannot be read is left out, and nothing here throws.
 */
export class TokenLedger {
  private readonly now: () => Date
  private readonly chunkBytes: number
  private readonly places = new Map<string, Place>()
  /** Answers by their id. One answer is written on several lines, and into more than one record. */
  private readonly answers = new Map<string, Answer>()
  private last: { at: number; days: DayTokens[] } | null = null

  constructor(private readonly options: LedgerOptions) {
    this.now = options.now ?? (() => new Date())
    this.chunkBytes = options.chunkBytes ?? CHUNK_BYTES
  }

  /** The last seven days, the oldest first. */
  async read(): Promise<DayTokens[]> {
    const today = this.now()
    if (this.last && today.getTime() - this.last.at < (this.options.freshForMs ?? 0)) {
      return this.last.days
    }
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (DAYS - 1))

    const records = await recordsIn(join(this.options.configDir, 'projects'), DEPTH)
    for (const path of records) await this.readOn(path, start.getTime()).catch(() => {})
    // Records that are gone are not remembered.
    const there = new Set(records)
    for (const path of this.places.keys()) if (!there.has(path)) this.places.delete(path)

    const days = new Map<string, DayTokens>()
    for (let index = 0; index < DAYS; index++) {
      const day = dayOf(new Date(start.getFullYear(), start.getMonth(), start.getDate() + index))
      days.set(day, { day, tokens: none(), models: {} })
    }
    for (const [id, answer] of this.answers) {
      const day = days.get(dayOf(new Date(answer.at)))
      if (!day) {
        if (answer.at < start.getTime()) this.answers.delete(id)
        continue
      }
      add(day.tokens, answer.tokens)
      add((day.models[answer.model] ??= none()), answer.tokens)
    }
    this.last = { at: today.getTime(), days: [...days.values()] }
    return this.last.days
  }

  private async readOn(path: string, since: number): Promise<void> {
    const { size, mtimeMs, ino } = await stat(path)
    if (mtimeMs < since) return
    const place = this.places.get(path)
    // Another file under the same name, or a shorter one than was read: written anew.
    let offset = place && place.file === ino && size >= place.offset ? place.offset : 0
    if (size === offset) return

    const file = await open(path, 'r')
    try {
      // The start of a line that the piece before ended in the middle of.
      let carried = Buffer.alloc(0)
      while (offset + carried.length < size) {
        const piece = Buffer.alloc(Math.min(this.chunkBytes, size - offset - carried.length))
        const { bytesRead } = await file.read(piece, 0, piece.length, offset + carried.length)
        if (bytesRead === 0) break
        const bytes = Buffer.concat([carried, piece.subarray(0, bytesRead)])
        // A line is only read once it is whole, which also keeps letters of several bytes together.
        const end = bytes.lastIndexOf(NEW_LINE) + 1
        for (const line of bytes.subarray(0, end).toString('utf8').split('\n')) this.take(line)
        offset += end
        carried = bytes.subarray(end)
        this.places.set(path, { file: ino, offset })
      }
    } finally {
      await file.close()
    }
  }

  private take(line: string): void {
    // Most lines are not answers, and telling so from the text is cheaper than reading them.
    if (!line.includes('"assistant"')) return
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      return
    }
    const { type, timestamp, message } = (value ?? {}) as Record<string, unknown>
    const { id, model, usage } = (message ?? {}) as Record<string, unknown>
    if (type !== 'assistant' || typeof id !== 'string' || typeof model !== 'string') return
    // Claude Code puts in answers of its own, which no model gave.
    if (model.startsWith('<') || typeof usage !== 'object' || usage === null) return
    const at = typeof timestamp === 'string' ? Date.parse(timestamp) : Number.NaN
    if (Number.isNaN(at)) return

    const spent = usage as Record<string, unknown>
    const tokens: Tokens = {
      input: count(spent.input_tokens),
      output: count(spent.output_tokens),
      cacheWrite: count(spent.cache_creation_input_tokens),
      cacheRead: count(spent.cache_read_input_tokens)
    }
    // An answer is written as it is given, each line saying more than the one before, and the
    // lines can lie in several records. Whichever is read last, the most that was said counts.
    const before = this.answers.get(id)
    if (before) {
      before.tokens = {
        input: Math.max(before.tokens.input, tokens.input),
        output: Math.max(before.tokens.output, tokens.output),
        cacheWrite: Math.max(before.tokens.cacheWrite, tokens.cacheWrite),
        cacheRead: Math.max(before.tokens.cacheRead, tokens.cacheRead)
      }
    } else {
      this.answers.set(id, { at, model, tokens })
    }
  }
}

async function recordsIn(folder: string, depth: number): Promise<string[]> {
  let entries
  try {
    entries = await readdir(folder, { withFileTypes: true })
  } catch {
    return []
  }
  const found: string[] = []
  for (const entry of entries) {
    const path = join(folder, entry.name)
    if (entry.isFile() && entry.name.endsWith(ENDING)) found.push(path)
    else if (entry.isDirectory() && depth > 1) found.push(...(await recordsIn(path, depth - 1)))
  }
  return found
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0
}

function none(): Tokens {
  return { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 }
}

function add(sum: Tokens, tokens: Tokens): void {
  sum.input += tokens.input
  sum.output += tokens.output
  sum.cacheWrite += tokens.cacheWrite
  sum.cacheRead += tokens.cacheRead
}

/** The day by the clock on the wall. */
function dayOf(time: Date): string {
  const month = String(time.getMonth() + 1).padStart(2, '0')
  return `${time.getFullYear()}-${month}-${String(time.getDate()).padStart(2, '0')}`
}
