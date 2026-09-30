import { useEffect, useId, useRef, useState } from 'react'
import type { AgendaState, Connection } from '@shared/types'
import { askCompanion, closeConnections, refreshAgenda } from '../controller'

// Where connectors are added to a Claude account, for the companion and every Claude session to reach.
const ADD_CONNECTORS_URL = 'https://claude.ai/settings/connectors'

/** What the companion is connected to: the calendar Telegraph reads, and the connectors of the Claude account. */
export function Connections({ agenda }: { agenda: AgendaState | null }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const [connections, setConnections] = useState<Connection[] | null>(null)

  useEffect(() => {
    dialog.current?.showModal()
    let shown = true
    void window.telegraph
      .listConnections()
      .then((found) => shown && setConnections(found))
      .catch(() => shown && setConnections([]))
    return () => {
      shown = false
    }
  }, [])

  const close = (): void => {
    dialog.current?.close()
    closeConnections()
  }

  const signIn = (): void => {
    close()
    // Claude Code lists its connectors there, and signs in to one that is chosen, in the browser.
    void askCompanion('/mcp')
  }

  const count = agenda?.meetings.length ?? 0
  const calendar =
    agenda === null || agenda.status === 'unknown'
      ? 'Not read yet.'
      : agenda.status === 'reading'
        ? 'Being read now…'
        : agenda.status === 'read'
          ? `Read ${count} meeting${count === 1 ? '' : 's'}${agenda.readAt ? ` at ${clockOf(agenda.readAt)}` : ''}.`
          : agenda.reason ?? 'Could not be read.'

  return (
    <dialog
      className="dialog connections"
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        close()
      }}
    >
      <h1 id={titleId}>Connections</h1>

      <h2>Calendar</h2>
      <p className="dialog-hint">
        Telegraph asks Claude for your meetings every hour, and offers help half an hour before each.
      </p>
      <p className="connections-calendar" data-status={agenda?.status ?? 'unknown'}>
        {calendar}
      </p>
      <div className="dialog-actions connections-actions">
        {(agenda?.status === 'unavailable' || agenda?.status === 'failed') && (
          <button type="button" className="action-button" onClick={signIn}>
            Sign in
          </button>
        )}
        <button type="button" className="quiet-button" onClick={refreshAgenda}>
          Read now
        </button>
      </div>
      {(agenda?.status === 'unavailable' || agenda?.status === 'failed') && (
        <p className="dialog-hint">
          Sign in opens the list of connectors in the companion: choose Google Calendar and sign in
          with Google in the browser. It can also be connected in the{' '}
          <button
            type="button"
            className="link-button"
            onClick={() => window.telegraph.openExternal(ADD_CONNECTORS_URL)}
          >
            connector settings of your Claude account
          </button>
          .
        </p>
      )}

      <h2>Your Claude account</h2>
      <p className="dialog-hint">The companion and every Claude session can use these.</p>
      {connections === null ? (
        <p className="dialog-hint">Looking…</p>
      ) : connections.length === 0 ? (
        <p className="dialog-hint">None found.</p>
      ) : (
        <ul className="connections-list">
          {connections.map((connection) => (
            <li key={`${connection.account} ${connection.name}`} data-reachable={connection.reachable}>
              <span>{connection.name}</span>
              <span className="connections-state">{connection.reachable ? 'Connected' : 'Not reachable'}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="dialog-actions">
        <button
          type="button"
          className="quiet-button"
          onClick={() => window.telegraph.openExternal(ADD_CONNECTORS_URL)}
        >
          Add Outlook, iCloud and others
        </button>
        <button type="button" className="action-button" onClick={close}>
          Done
        </button>
      </div>
    </dialog>
  )
}

function clockOf(time: string): string {
  const at = new Date(time)
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
}
