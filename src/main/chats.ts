import { open, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Chat } from '@shared/types'

const DEFAULT_LIMIT = 15
// Records that are left out, for one reason or another, do not count towards the limit.
const SPARE = 10
// A record can be many megabytes. The first thing said is at its start, and
// the title it was given last is near its end.
const HEAD_BYTES = 256 * 1024
const TAIL_BYTES = 64 * 1024
const TITLE_LENGTH = 60

const RECORD = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i

export interface ChatsOptions {
  /** Where Claude Code keeps what it knows, which is `.claude` in the home folder unless it was moved. */
  configDir: string
  projectPath: string
  limit?: number
}

/** The folder Claude Code keeps the chats of a folder in: its path, with a dash for all but letters and digits. */
export function folderOf(projectPath: string): string {
  return projectPath.replace(/[^A-Za-z0-9]/g, '-')
}

/**
 * The chats Claude Code has had in a folder, the latest first. Read from its
 * own records, which are not Telegraph's to rely on: what cannot be read is
 * left out, and nothing here throws.
 */
export async function listChats({
  configDir,
  projectPath,
  limit = DEFAULT_LIMIT
}: ChatsOptions): Promise<Chat[]> {
  const folder = join(configDir, 'projects', folderOf(projectPath))
  try {
    const names = (await readdir(folder)).filter((name) => RECORD.test(name))
    const records = await Promise.all(
      names.map(async (name) => {
        const path = join(folder, name)
        return { path, id: RECORD.exec(name)![1]!, at: (await stat(path)).mtime }
      })
    )
    records.sort((one, other) => other.at.getTime() - one.at.getTime())

    const chats = await Promise.all(
      records.slice(0, limit + SPARE).map(async ({ path, id, at }) => {
        const title = await readTitle(path, projectPath).catch(() => null)
        return title === null ? null : { id, title, at: at.toISOString() }
      })
    )
    return chats.filter((chat) => chat !== null).slice(0, limit)
  } catch {
    return []
  }
}

/** What to call the chat, or null if it is not a chat of the folder. */
async function readTitle(path: string, projectPath: string): Promise<string | null> {
  const file = await open(path, 'r')
  try {
    const { size } = await file.stat()
    const head = await readLines(file, 0, Math.min(size, HEAD_BYTES))
    const tail = size > HEAD_BYTES ? await readLines(file, Math.max(HEAD_BYTES, size - TAIL_BYTES), size) : []

    const hadElsewhere = head.find((line) => typeof line.cwd === 'string')
    if (hadElsewhere && hadElsewhere.cwd !== projectPath) return null
    if (head.some((line) => line.type === 'user' && line.isSidechain === true)) return null

    const given = [...head, ...tail].findLast((line) => line.type === 'ai-title')?.aiTitle
    const title = tidy(given) ?? head.map(saidBy).find((text) => text !== null)
    return title ?? null
  } finally {
    await file.close()
  }
}

async function readLines(
  file: Awaited<ReturnType<typeof open>>,
  from: number,
  to: number
): Promise<Record<string, unknown>[]> {
  const bytes = Buffer.alloc(to - from)
  await file.read(bytes, 0, bytes.length, from)
  // The first and the last line may be cut, and are then no JSON.
  return bytes
    .toString('utf8')
    .split('\n')
    .flatMap((line) => {
      try {
        const value: unknown = JSON.parse(line)
        return typeof value === 'object' && value !== null ? [value as Record<string, unknown>] : []
      } catch {
        return []
      }
    })
}

/** What the user said in the line, or null if it is not the user speaking. */
function saidBy(line: Record<string, unknown>): string | null {
  if (line.type !== 'user' || line.isMeta === true) return null
  const content = (line.message as { content?: unknown } | undefined)?.content
  const texts = typeof content === 'string' ? [content] : Array.isArray(content) ? content.map(textOf) : []
  return texts.map(tidy).find((text) => text !== undefined) ?? null
}

function textOf(part: unknown): unknown {
  const { type, text } = (part ?? {}) as { type?: unknown; text?: unknown }
  return type === 'text' ? text : undefined
}

/** One line of no more than the length of a title. Nothing for what is not said by a person. */
function tidy(text: unknown): string | undefined {
  if (typeof text !== 'string') return undefined
  const line = text.replace(/\s+/g, ' ').trim()
  // Commands and what the program notes for itself are written in tags.
  if (line === '' || line.startsWith('<')) return undefined
  return line.length <= TITLE_LENGTH ? line : `${line.slice(0, TITLE_LENGTH - 1).trimEnd()}…`
}
