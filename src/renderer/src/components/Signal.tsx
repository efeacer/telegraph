import type { SessionStatus } from '@shared/status'

/**
 * A session's mark on the wire. Each status has its own shape as well as its
 * own colour, so the marks read without relying on colour alone.
 */
export function Signal({ status, paused = false }: { status: SessionStatus; paused?: boolean }) {
  return (
    <span className="signal" data-status={paused && status !== 'exited' ? 'paused' : status} aria-hidden="true">
      <span className="signal-mark" />
    </span>
  )
}
