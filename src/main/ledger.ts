import { open, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { DayTokens, Tokens } from '@shared/types'

const DAYS = 7
// Records of chats lie two folders deep, those of the helpers of an agent four.
const DEPTH = 4
const ENDING = '.jsonl'
const NEW_LINE = 0x0a

export interface LedgerOptions {
  /** Where Claude Code keeps what it knows, which is `.claude` in the home folder unless it was moved. */
  configDir: string
  now?: () => Date
}

interface Answer {
  at: number
  model: string
  tokens: Tokens
}

/**
 * What the answers of the last week took, read from the records Claude Code
 * keeps of every chat on this machine. The records grow while chats go on, so
 * each is read on from where the ledger last was. They are not Telegraph's
 * to rely on: what cannot be read is left out, and nothing here throws.
 */
export class TokenLedger {
  private readonly now: () => Date
  /** How far each record has been read. */
  private readonly readUpTo = new Map<string, number>()
  /** Answers by their id. One answer is written on several lines, and into more than one record. */
  private readonly answers = new Map<string, Answer>()

  constructor(private readonly options: LedgerOptions) {
    this.now = options.now ?? (() => new Date())
  }

  /** The last seven days, the oldest first. */
  async read(): Promise<DayTokens[]> {
    const today = this.now()
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (DAYS - 1))

    for (const path of await recordsIn(join(this.options.configDir, 'projects'), DEPTH)) {
      await this.readOn(path, start.getTime()).catch(() => {})
    }

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
    return [...days.values()]
  }

  private async readOn(path: string, since: number): Promise<void> {
    const { size, mtimeMs } = await stat(path)
    if (mtimeMs < since) return
    let from = this.readUpTo.get(path) ?? 0
    // Shorter than what was read of it: written anew.
    if (size < from) from = 0
    if (size === from) return

    const file = await open(path, 'r')
    try {
      const bytes = Buffer.alloc(size - from)
      const { bytesRead } = await file.read(bytes, 0, bytes.length, from)
      // A line is only read once it is whole.
      const end = bytes.lastIndexOf(NEW_LINE, bytesRead - 1) + 1
      for (const line of bytes.subarray(0, end).toString('utf8').split('\n')) this.take(line)
      this.readUpTo.set(path, from + end)
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
    const { type, timestamp, requestId, message } = (value ?? {}) as Record<string, unknown>
    const { id, model, usage } = (message ?? {}) as Record<string, unknown>
    if (type !== 'assistant' || typeof id !== 'string' || typeof model !== 'string') return
    // Claude Code puts in answers of its own, which no model gave.
    if (model.startsWith('<') || typeof usage !== 'object' || usage === null) return
    const at = typeof timestamp === 'string' ? Date.parse(timestamp) : Number.NaN
    if (Number.isNaN(at)) return

    const spent = usage as Record<string, unknown>
    // The last line of an answer replaces the ones before: it is written when the answer is complete.
    this.answers.set(`${id} ${typeof requestId === 'string' ? requestId : ''}`, {
      at,
      model,
      tokens: {
        input: count(spent.input_tokens),
        output: count(spent.output_tokens),
        cacheWrite: count(spent.cache_creation_input_tokens),
        cacheRead: count(spent.cache_read_input_tokens)
      }
    })
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
