import { useLayoutEffect, useRef } from 'react'
import { STATUS_LABELS } from '@shared/status'
import { activateSession, endSession, placeTerminal } from '../controller'
import { sessionLabel, type SessionView } from '../store'
import { Signal } from './Signal'

interface TileProps {
  session: SessionView
  /** The name of the project, where sessions of several projects are shown together. */
  project: string
  active: boolean
  /** With a head that says which session it is, which one session on its own does not need. */
  framed: boolean
  /** How many columns of the grid it takes. */
  span: number
}

/** The place of a session on the stage. Its terminal lives outside React, and is moved in and out. */
export function Tile({ session, project, active, framed, span }: TileProps) {
  const body = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    placeTerminal(session.id, body.current)
    return () => placeTerminal(session.id, null)
  }, [session.id])

  const label = sessionLabel(session)
  const classes = ['tile', active && 'is-active', framed && 'is-framed'].filter(Boolean).join(' ')

  return (
    <section
      className={classes}
      style={{ gridColumn: `span ${span}` }}
      data-status={session.status}
      aria-label={framed ? `${label} in ${project}` : undefined}
      // Before the terminal takes the press for itself, so that the keys go where the user pointed.
      onMouseDownCapture={() => {
        if (!active) activateSession(session.id)
      }}
    >
      {framed && (
        <header className="tile-head">
          <Signal status={session.status} />
          <span className="tile-title">{label}</span>
          <span className="tile-project">{project}</span>
          <span className="tile-status">{STATUS_LABELS[session.status]}</span>
          {session.unread && <span className="tile-badge" role="img" aria-label="Something new" />}
          <button
            type="button"
            className="icon-button tile-end"
            aria-label={`End ${label}`}
            onMouseDownCapture={(event) => event.stopPropagation()}
            onClick={() => void endSession(session.id)}
          >
            <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
              <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </header>
      )}
      <div className="tile-body" ref={body} />
    </section>
  )
}
