import type { SessionStatus } from '@shared/status'

/**
 * A session's mark on the wire. Each status has its own shape as well as its
 * own colour, so the marks read without relying on colour alone.
 */
export function Signal({ status }: { status: SessionStatus }) {
  return (
    <span className="signal" data-status={status} aria-hidden="true">
      <span className="signal-mark" />
    </span>
  )
}
