import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { dueNudges, parseAgenda, type Meeting } from '@shared/agenda'
import type { AgendaState } from '@shared/types'

const TOLD_KEPT = 200
const QUERY_TIMEOUT_MS = 3 * 60_000
const PROMPT_VARIABLE = 'TELEGRAPH_AGENDA_PROMPT'
// Only the calendar, and a small model: this is asked every hour, and costs each time.
const QUERY = `claude -p "$${PROMPT_VARIABLE}" --model haiku --output-format json --max-turns 6 --allowedTools mcp__claude_ai_Google_Calendar`

/** What the agent is asked for the meetings. The answer is read by parseAgenda. */
export function agendaPrompt(now: Date): string {
  return [
    `It is now ${now.toString()}.`,
    'Using your Google Calendar tools, list my calendar events from now until the end of tomorrow, in my time zone.',
    'Only read. Never create, change or delete anything, and do not reply to invitations.',
    'Answer with one line and nothing else:',
    'EVENTS: followed by a JSON array of {"title", "start", "end", "allDay"}, with start and end in ISO 8601 with the offset.',
    'If you cannot read the calendar, answer with one line: EVENTS: UNAVAILABLE followed by the reason.'
  ].join('\n')
}

/** The answer out of what `claude -p --output-format json` prints. Throws when there is none. */
export function readQueryOutput(output: string): { answer: string; costUsd: number | null } {
  const { result, is_error: failed, total_cost_usd: cost } = JSON.parse(output) as Record<string, unknown>
  if (typeof result !== 'string') throw new Error('Claude gave no answer')
  if (failed === true) throw new Error(result.slice(0, 300))
  return { answer: result, costUsd: typeof cost === 'number' ? cost : null }
}

/**
 * Asks Claude, in the background and as the user's shell would find it, for
 * the meetings. Claude reads them through the connector of the user's
 * account: Telegraph never holds the keys to the calendar itself.
 */
export function askClaudeForAgenda(options: {
  shell: string
  cwd: string
  env: Record<string, string>
  now?: () => Date
}): () => Promise<string> {
  return () =>
    new Promise((resolve, reject) => {
      const child = spawn(options.shell, ['-l', '-c', QUERY], {
        cwd: options.cwd,
        env: { ...options.env, [PROMPT_VARIABLE]: agendaPrompt(options.now?.() ?? new Date()) },
        stdio: ['ignore', 'pipe', 'pipe']
      })
      let output = ''
      let errors = ''
      const timer = setTimeout(() => child.kill('SIGKILL'), QUERY_TIMEOUT_MS)
      child.stdout.setEncoding('utf8').on('data', (text: string) => (output += text))
      child.stderr.setEncoding('utf8').on('data', (text: string) => (errors = (errors + text).slice(-2000)))
      child.on('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        try {
          resolve(readQueryOutput(output).answer)
        } catch (error) {
          reject(code === 0 ? error : new Error(errors.trim().split('\n').at(-1) || `claude ended with ${code}`))
        }
      })
    })
}

export interface AgendaOptions {
  filePath: string
  fetch: () => Promise<string>
  onNudge(meeting: Meeting): void
  onChange(state: AgendaState): void
  now?: () => number
}

/**
 * Keeps the meetings of the user, asks for them anew when told to, and tells
 * of each meeting once, shortly before it. What it read is kept on disk, so
 * that a restart neither loses the meetings nor tells of one twice.
 */
export class AgendaWatcher {
  private readonly now: () => number
  private current: AgendaState = { status: 'unknown', meetings: [], readAt: null, reason: null }
  private told = new Set<string>()
  private reading: Promise<void> | null = null

  constructor(private readonly options: AgendaOptions) {
    this.now = options.now ?? Date.now
  }

  state(): AgendaState {
    return { ...this.current, meetings: this.upcoming(this.current.meetings) }
  }

  load(): void {
    try {
      const kept = JSON.parse(readFileSync(this.options.filePath, 'utf8')) as Record<string, unknown>
      const reading = parseAgenda(`EVENTS: ${JSON.stringify(kept.meetings ?? [])}`)
      if (reading.status !== 'read' || typeof kept.readAt !== 'string') return
      this.current = { status: 'read', meetings: reading.meetings, readAt: kept.readAt, reason: null }
      if (Array.isArray(kept.told)) this.told = new Set(kept.told.filter((id) => typeof id === 'string'))
    } catch {
      // Read anew.
    }
  }

  /** Asks for the meetings. Never rejects: what went wrong is in the state. */
  refresh(): Promise<void> {
    this.reading ??= this.read().finally(() => {
      this.reading = null
    })
    return this.reading
  }

  /** Tells of the meetings that are near. Called every minute. */
  check(): void {
    const due = dueNudges(this.current.meetings, this.now(), this.told)
    if (due.length === 0) return
    for (const meeting of due) this.told.add(meeting.id)
    this.save()
    for (const meeting of due) this.options.onNudge(meeting)
  }

  private async read(): Promise<void> {
    this.update({ ...this.current, status: 'reading' })
    try {
      const reading = parseAgenda(await this.options.fetch())
      if (reading.status === 'read') {
        this.update({ status: 'read', meetings: reading.meetings, readAt: new Date(this.now()).toISOString(), reason: null })
        this.save()
      } else if (reading.status === 'unavailable') {
        this.update({ ...this.current, status: 'unavailable', reason: reading.reason || 'The calendar could not be read.' })
      } else {
        this.update({ ...this.current, status: 'failed', reason: 'Claude did not answer with the meetings.' })
      }
    } catch (error) {
      this.update({ ...this.current, status: 'failed', reason: error instanceof Error ? error.message : String(error) })
    }
  }

  private update(state: AgendaState): void {
    this.current = state
    this.options.onChange(this.state())
  }

  private upcoming(meetings: Meeting[]): Meeting[] {
    return meetings.filter((meeting) => Date.parse(meeting.end) > this.now())
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.options.filePath), { recursive: true })
      const kept = {
        meetings: this.upcoming(this.current.meetings),
        readAt: this.current.readAt,
        told: [...this.told].slice(-TOLD_KEPT)
      }
      writeFileSync(`${this.options.filePath}.tmp`, JSON.stringify(kept), { mode: 0o600 })
      renameSync(`${this.options.filePath}.tmp`, this.options.filePath)
    } catch {
      // Asked for again at the next start.
    }
  }
}
