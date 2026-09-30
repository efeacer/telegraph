import { useEffect, useState } from 'react'
import type { DayTokens, Limit, SessionMeter, Usage as UsageData } from '@shared/types'
import { refreshUsage } from '../controller'
import { compact, describeReset, modelName, newTokens } from '../format'

const OPEN_KEY = 'telegraph.usage.open'
// From where a limit is worth a look, and from where it is nearly gone.
const RAISED = 75
const HIGH = 90
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

type Level = 'fine' | 'raised' | 'high'

function levelOf(percent: number): Level {
  return percent >= HIGH ? 'high' : percent >= RAISED ? 'raised' : 'fine'
}

/** Whether the panel was left open. Kept by the window, since it is about nothing but the window. */
function wasOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === 'yes'
  } catch {
    return false
  }
}

interface UsageProps {
  usage: UsageData | null
  /** What the session in front reports of itself, if it reports. */
  session: SessionMeter | null
}

/** What the agents have used: a mark in the corner that opens into a panel. */
export function Usage({ usage, session }: UsageProps) {
  const [open, setOpen] = useState(wasOpen)

  const toggle = (): void => {
    const next = !open
    setOpen(next)
    try {
      localStorage.setItem(OPEN_KEY, next ? 'yes' : 'no')
    } catch {
      // Closed again at the next start, which is no loss.
    }
    // Chats in other terminals say nothing when they use something, so this is a moment to look.
    if (next) void refreshUsage()
  }

  const today = usage?.days.at(-1)
  const fiveHour = usage?.limits?.fiveHour ?? null

  return (
    <>
      <button
        type="button"
        className="usage-chip"
        aria-label={`Usage, ${describeChip(fiveHour, today)}`}
        aria-expanded={open}
        onClick={toggle}
      >
        {fiveHour ? (
          <>
            <Ring percent={fiveHour.usedPercent} size={16} stroke={3} />
            <span>{Math.round(fiveHour.usedPercent)}%</span>
          </>
        ) : (
          <span>{today ? `${compact(newTokens(today.tokens))} tokens` : 'Usage'}</span>
        )}
      </button>
      {open && usage && <Panel usage={usage} session={session} />}
    </>
  )
}

function describeChip(fiveHour: Limit | null, today: DayTokens | undefined): string {
  if (fiveHour) return `${Math.round(fiveHour.usedPercent)}% of the 5-hour limit used`
  return today ? `${compact(newTokens(today.tokens))} tokens today` : 'not read yet'
}

function Panel({ usage, session }: { usage: UsageData; session: SessionMeter | null }) {
  // The times until the limits start over are told in minutes, so they are told anew every minute.
  const [, setMinute] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setMinute((minute) => minute + 1), 60_000)
    return () => clearInterval(timer)
  }, [])

  const { limits, days, reporting } = usage
  const today = days.at(-1)

  return (
    <section className="usage-panel" role="region" aria-label="Usage">
      {limits ? (
        <div className="usage-limits">
          {limits.fiveHour && <LimitMeter name="5-hour limit" limit={limits.fiveHour} />}
          {limits.week && <LimitMeter name="Weekly limit" limit={limits.week} />}
        </div>
      ) : (
        <p className="usage-note">
          {reporting
            ? 'The limits of your plan show once a session of Claude started here has answered.'
            : 'The limits of your plan are not shown, because Claude Code is set up with a status line of its own, which asking for them would take the place of.'}
        </p>
      )}

      {today && (
        <div className="usage-block">
          <h2>Tokens today</h2>
          <p className="usage-figure">{compact(newTokens(today.tokens))}</p>
          <p className="usage-aside">
            {newTokens(today.tokens) + today.tokens.cacheRead === 0
              ? 'Nothing was used yet today.'
              : `${compact(today.tokens.output)} written, ${compact(today.tokens.input + today.tokens.cacheWrite)} read. Another ${compact(today.tokens.cacheRead)} read again from the cache.`}
          </p>
          <Week days={days} />
          <Models day={today} />
        </div>
      )}

      {session && (session.contextPercent !== null || session.costUsd !== null) && (
        <div className="usage-block usage-session">
          <h2>This session{session.model ? `, on ${session.model}` : ''}</h2>
          {session.contextPercent !== null && (
            <div className="usage-row">
              <Ring percent={session.contextPercent} size={16} stroke={3} />
              <span>{Math.round(session.contextPercent)}% of its context is full</span>
            </div>
          )}
          {session.costUsd !== null && (
            <p className="usage-aside">
Would be ${session.costUsd.toFixed(2)} at list prices. A plan is not billed by them.
            </p>
          )}
        </div>
      )}
    </section>
  )
}

function LimitMeter({ name, limit }: { name: string; limit: Limit }) {
  const percent = Math.round(limit.usedPercent)
  const level = levelOf(limit.usedPercent)
  const reset = limit.resetsAt ? describeReset(limit.resetsAt) : ''
  const warning = level === 'high' ? 'Nearly used up' : level === 'raised' ? 'Running low' : ''

  return (
    <div
      className="usage-limit"
      role="meter"
      aria-label={name}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={`${percent}% used${reset ? `, starts over ${reset}` : ''}`}
      data-level={level}
    >
      <div className="usage-dial">
        <Ring percent={limit.usedPercent} size={76} stroke={7} />
        <span className="usage-dial-figure">
          {percent}
          <small>%</small>
        </span>
      </div>
      <p className="usage-limit-name">{name}</p>
      {/* Said in words too: the colour of the ring is not all that tells a limit is running out. */}
      {warning && <p className="usage-warning">{warning}</p>}
      <p className="usage-aside">{reset ? `starts over ${reset}` : 'has started over'}</p>
    </div>
  )
}

/** A ring that fills clockwise from the top, by how much of something is used. */
function Ring({ percent, size, stroke }: { percent: number; size: number; stroke: number }) {
  const radius = (size - stroke) / 2
  const around = 2 * Math.PI * radius
  const used = (Math.min(100, Math.max(0, percent)) / 100) * around
  return (
    <svg
      className="usage-ring"
      data-level={levelOf(percent)}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
    >
      <circle className="usage-ring-track" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} />
      {used > 0 && (
        <circle
          className="usage-ring-fill"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          strokeDasharray={`${used} ${around}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      )}
    </svg>
  )
}

/** The days of the week as columns. A list as well, so that every value can be read without pointing at it. */
function Week({ days }: { days: DayTokens[] }) {
  const most = Math.max(1, ...days.map((day) => newTokens(day.tokens)))
  return (
    <ol className="usage-week" aria-label="Tokens by day">
      {days.map((day, index) => {
        const count = newTokens(day.tokens)
        const isToday = index === days.length - 1
        const name = isToday ? 'Today' : weekdayOf(day.day)
        return (
          <li
            key={day.day}
            className={isToday ? 'usage-day is-today' : 'usage-day'}
            aria-label={`${name}: ${compact(count)}`}
            tabIndex={0}
          >
            <span className="usage-day-value" aria-hidden="true">
              {compact(count)}
            </span>
            <span
              className="usage-day-column"
              aria-hidden="true"
              // A day on which anything was used shows, however little it was next to the others.
              style={{ height: count === 0 ? 0 : `max(2px, ${(count / most) * 100}%)` }}
            />
            <span className="usage-day-name" aria-hidden="true">
              {name.slice(0, isToday ? 5 : 2)}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

function Models({ day }: { day: DayTokens }) {
  const models = Object.entries(day.models)
    .map(([id, tokens]) => ({ id, count: newTokens(tokens) }))
    .filter((model) => model.count > 0)
    .sort((one, other) => other.count - one.count)
  if (models.length === 0) return null
  return (
    <ul className="usage-models" aria-label="Tokens today by model">
      {models.map(({ id, count }) => (
        <li key={id}>
          <span>{modelName(id)}</span>
          <span className="usage-count">{compact(count)}</span>
        </li>
      ))}
    </ul>
  )
}

function weekdayOf(day: string): string {
  const [year, month, date] = day.split('-').map(Number)
  return WEEKDAYS[new Date(year!, month! - 1, date).getDay()]!
}
