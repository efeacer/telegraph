import { useLayoutEffect, useRef } from 'react'
import { activateSession, endSession, placeTerminal, startRenaming } from '../controller'
import { sessionLabel, statusLabel, type SessionView } from '../store'
import { NameField } from './NameField'
import { SessionControls } from './SessionControls'
import { Signal } from './Signal'

interface TileProps {
  session: SessionView
  model: string | null
  /** The name of the project, where sessions of several projects are shown together. */
  project: string
  active: boolean
  /** With a head that says which session it is, which one session on its own does not need. */
  framed: boolean
  /** How many columns of the grid it takes. */
  span: number
  renaming: boolean
}

/** The place of a session on the stage. Its terminal lives outside React, and is moved in and out. */
export function Tile({ session, model, project, active, framed, span, renaming }: TileProps) {
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
      aria-current={framed && active ? 'true' : undefined}
      // Before the terminal takes the press for itself, so that the keys go where the user pointed.
      // Not for the button that ends the session: ending one is not going to it.
      onMouseDownCapture={(event) => {
        if (!active && !(event.target as Element).closest('.tile-end, .session-controls')) activateSession(session.id)
      }}
    >
      {framed && (
        <header
          className="tile-head"
          // A press on what cannot take the keys would take them from the terminal.
          onMouseDown={(event) => {
            if (!(event.target as Element).closest('.tile-end, .name-field, .session-controls')) event.preventDefault()
          }}
        >
          <Signal status={session.status} paused={session.paused} />
          {renaming ? (
            <NameField sessionId={session.id} name={session.name ?? label} />
          ) : (
            <span
              className="tile-title"
              title="Double-click to rename"
              onDoubleClick={() => startRenaming(session.id, 'tile')}
            >
              {label}
            </span>
          )}
          {model && <span className="tile-model">{model}</span>}
          <span className="tile-project">{project}</span>
          <span className="tile-status">{statusLabel(session)}</span>
          {session.unread && <span className="tile-badge" role="img" aria-label="Something new" />}
          <SessionControls session={session} />
          <button
            type="button"
            className="icon-button tile-end"
            aria-label={`End ${label}`}
            onClick={() => void endSession(session.id)}
          >
            <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
              <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </header>
      )}
      <div
        className="tile-body"
        ref={body}
        // The keys can get here without a press, as when a file is dropped. The tile they are in is the one in front.
        onFocusCapture={() => {
          if (!active) activateSession(session.id)
        }}
      />
    </section>
  )
}
