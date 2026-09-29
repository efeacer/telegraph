/**
 * Infers what a session is doing from the timing of its terminal traffic.
 *
 * Agents redraw continuously while they work (spinners, streamed text) and go
 * quiet when they finish or stop to ask something, so sustained output means
 * "working" and the silence that follows means "waiting for you".
 */

export type SessionStatus = 'idle' | 'working' | 'attention' | 'exited'

export interface StatusState {
  status: SessionStatus
  lastInputAt: number
  lastOutputAt: number
  /** Start of the current run of output, or null when the session is quiet. */
  burstStartedAt: number | null
}

export type StatusEvent =
  | { type: 'output'; at: number }
  | { type: 'input'; at: number }
  | { type: 'bell'; focused: boolean }
  | { type: 'tick'; at: number; focused: boolean }
  | { type: 'focus' }
  | { type: 'exit' }

/** Output this soon after a keystroke is the terminal echoing it back. */
export const ECHO_WINDOW_MS = 300
/** Output must keep coming for this long before it counts as work. */
export const SUSTAIN_MS = 800
/** Silence for this long ends a run of output. */
export const QUIET_MS = 2000

export function initialStatus(): StatusState {
  return { status: 'idle', lastInputAt: -Infinity, lastOutputAt: -Infinity, burstStartedAt: null }
}

export function reduceStatus(state: StatusState, event: StatusEvent): StatusState {
  if (state.status === 'exited') return state

  switch (event.type) {
    case 'exit':
      return { ...state, status: 'exited', burstStartedAt: null }

    case 'input':
      return {
        ...state,
        lastInputAt: event.at,
        status: state.status === 'attention' ? 'idle' : state.status
      }

    case 'focus':
      return state.status === 'attention' ? { ...state, status: 'idle' } : state

    case 'bell':
      return event.focused ? state : { ...state, status: 'attention' }

    case 'output': {
      if (event.at - state.lastInputAt < ECHO_WINDOW_MS) return state
      const burstStartedAt =
        state.burstStartedAt !== null && event.at - state.lastOutputAt <= QUIET_MS
          ? state.burstStartedAt
          : event.at
      const sustained = event.at - burstStartedAt >= SUSTAIN_MS
      return {
        ...state,
        lastOutputAt: event.at,
        burstStartedAt,
        status: sustained ? 'working' : state.status
      }
    }

    case 'tick': {
      if (state.burstStartedAt === null) return state
      if (event.at - state.lastOutputAt <= QUIET_MS) return state
      if (state.status !== 'working') return { ...state, burstStartedAt: null }
      return { ...state, burstStartedAt: null, status: event.focused ? 'idle' : 'attention' }
    }
  }
}

export const STATUS_LABELS: Record<SessionStatus, string> = {
  idle: 'Idle',
  working: 'Working',
  attention: 'Waiting for you',
  exited: 'Ended'
}
