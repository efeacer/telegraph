import { describe, expect, it } from 'vitest'
import {
  QUIET_MS,
  SUSTAIN_MS,
  initialStatus,
  reduceStatus,
  type StatusEvent,
  type StatusState
} from './status'

function run(events: StatusEvent[], from: StatusState = initialStatus()): StatusState {
  return events.reduce(reduceStatus, from)
}

/** Output every 100ms from `start` for `duration`, like an agent's spinner. */
function outputRun(start: number, duration: number): StatusEvent[] {
  const events: StatusEvent[] = []
  for (let at = start; at <= start + duration; at += 100) events.push({ type: 'output', at })
  return events
}

describe('reduceStatus', () => {
  it('starts idle', () => {
    expect(initialStatus().status).toBe('idle')
  })

  it('stays idle for a short burst of output', () => {
    const state = run(outputRun(1000, SUSTAIN_MS - 200))
    expect(state.status).toBe('idle')
  })

  it('becomes working once output is sustained', () => {
    const state = run(outputRun(1000, SUSTAIN_MS))
    expect(state.status).toBe('working')
  })

  it('ignores output that echoes a keystroke', () => {
    const events: StatusEvent[] = []
    for (let at = 1000; at <= 1000 + SUSTAIN_MS * 3; at += 100) {
      events.push({ type: 'input', at })
      events.push({ type: 'output', at: at + 50 })
    }
    expect(run(events).status).toBe('idle')
  })

  it('asks for attention when work stops in a background session', () => {
    const working = run(outputRun(1000, SUSTAIN_MS))
    const state = reduceStatus(working, {
      type: 'tick',
      at: working.lastOutputAt + QUIET_MS + 1,
      focused: false
    })
    expect(state.status).toBe('attention')
  })

  it('goes idle when work stops in the session being watched', () => {
    const working = run(outputRun(1000, SUSTAIN_MS))
    const state = reduceStatus(working, {
      type: 'tick',
      at: working.lastOutputAt + QUIET_MS + 1,
      focused: true
    })
    expect(state.status).toBe('idle')
  })

  it('keeps working through pauses shorter than the quiet period', () => {
    const working = run(outputRun(1000, SUSTAIN_MS))
    const state = reduceStatus(working, {
      type: 'tick',
      at: working.lastOutputAt + QUIET_MS,
      focused: false
    })
    expect(state.status).toBe('working')
  })

  it('does not ask for attention after a short burst in the background', () => {
    const burst = run(outputRun(1000, 200))
    const state = reduceStatus(burst, {
      type: 'tick',
      at: burst.lastOutputAt + QUIET_MS + 1,
      focused: false
    })
    expect(state.status).toBe('idle')
    expect(state.burstStartedAt).toBeNull()
  })

  it('starts a new burst after a quiet period', () => {
    const first = run(outputRun(1000, 400))
    const resumedAt = first.lastOutputAt + QUIET_MS + 500
    const state = run(outputRun(resumedAt, SUSTAIN_MS - 200), first)
    expect(state.status).toBe('idle')
    expect(state.burstStartedAt).toBe(resumedAt)
  })

  it('asks for attention on a bell in a background session', () => {
    expect(reduceStatus(initialStatus(), { type: 'bell', focused: false }).status).toBe('attention')
  })

  it('ignores a bell in the session being watched', () => {
    expect(reduceStatus(initialStatus(), { type: 'bell', focused: true }).status).toBe('idle')
  })

  it('clears attention when the session gets focus', () => {
    const attention = reduceStatus(initialStatus(), { type: 'bell', focused: false })
    expect(reduceStatus(attention, { type: 'focus' }).status).toBe('idle')
  })

  it('clears attention when the user types', () => {
    const attention = reduceStatus(initialStatus(), { type: 'bell', focused: false })
    expect(reduceStatus(attention, { type: 'input', at: 5000 }).status).toBe('idle')
  })

  it('keeps working when the session gets focus', () => {
    const working = run(outputRun(1000, SUSTAIN_MS))
    expect(reduceStatus(working, { type: 'focus' }).status).toBe('working')
  })

  it('stays exited whatever happens next', () => {
    const exited = reduceStatus(initialStatus(), { type: 'exit' })
    const state = run([...outputRun(1000, SUSTAIN_MS), { type: 'bell', focused: false }], exited)
    expect(state.status).toBe('exited')
  })
})
