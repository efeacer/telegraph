import { useEffect, useId, useRef, useState } from 'react'
import type { AgendaState, Connection, GoogleStatus } from '@shared/types'
import { askCompanion, closeConnections, refreshAgenda } from '../controller'
import { Icon } from './Icon'

// Where connectors are added to a Claude account, which Claude's sessions can reach besides.
const CLAUDE_CONNECTORS_URL = 'https://claude.ai/settings/connectors'

/** What Telegraph is connected to, in a pane at the side: Google in one press, and Claude's own connectors. */
export function Connections({ agenda, google }: { agenda: AgendaState | null; google: GoogleStatus }) {
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

  const signInToClaude = (): void => {
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
  const claudeCannotRead = google.state !== 'connected' && (agenda?.status === 'unavailable' || agenda?.status === 'failed')

  return (
    <dialog
      className="pane connections"
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        close()
      }}
    >
      <header className="pane-head">
        <h1 id={titleId}>Connections</h1>
        <button type="button" className="icon-button" aria-label="Close" onClick={close}>
          <Icon name="close" />
        </button>
      </header>

      <section className="card" aria-label="Google">
        <div className="card-head">
          <span className="card-mark google-mark" aria-hidden="true">
            G
          </span>
          <div>
            <h2>Google</h2>
            <p className="card-hint">
              <Icon name="calendar" size={13} /> Calendar <Icon name="mail" size={13} /> Gmail. Your agents can read them;
              nothing is changed or sent.
            </p>
          </div>
        </div>
        <GoogleCard status={google} />
      </section>

      <section className="card" aria-label="Meetings">
        <div className="card-head">
          <span className="card-mark" aria-hidden="true">
            <Icon name="calendar" />
          </span>
          <div>
            <h2>Meeting reminders</h2>
            <p className="card-hint">Half an hour before a meeting, Telegraph offers to help you prepare.</p>
          </div>
        </div>
        <p className="connections-calendar" data-status={agenda?.status ?? 'unknown'}>
          {calendar}
        </p>
        <div className="card-actions">
          <button type="button" className="quiet-button" onClick={refreshAgenda}>
            Read now
          </button>
          {claudeCannotRead && (
            <button type="button" className="action-button" onClick={signInToClaude}>
              Sign in
            </button>
          )}
        </div>
      </section>

      <details className="card more">
        <summary>
          <h2>More for Claude</h2>
        </summary>
        <p className="card-hint">
          Claude sessions can also use the connectors of your Claude account, such as Drive, Outlook or iCloud.
        </p>
        {connections === null ? (
          <p className="card-hint">Looking…</p>
        ) : connections.length === 0 ? (
          <p className="card-hint">None found.</p>
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
        <div className="card-actions">
          <button type="button" className="quiet-button" onClick={() => window.telegraph.openExternal(CLAUDE_CONNECTORS_URL)}>
            Add Outlook, iCloud and others
          </button>
        </div>
      </details>

      <footer className="pane-foot">
        <button type="button" className="action-button" onClick={close}>
          Done
        </button>
      </footer>
    </dialog>
  )
}

// Each page of Google Cloud that the registration takes, in order.
const SETUP_STEPS = [
  {
    title: 'Create a project',
    text: 'Sign in to Google Cloud with your Google account, and create a project named Telegraph. It is free.',
    url: 'https://console.cloud.google.com/projectcreate'
  },
  {
    title: 'Turn on Calendar and Gmail',
    text: 'Press Enable on the Google Calendar API, then on the Gmail API, which opens next.',
    url: 'https://console.cloud.google.com/apis/library/calendar-json.googleapis.com',
    then: 'https://console.cloud.google.com/apis/library/gmail.googleapis.com'
  },
  {
    title: 'Describe the app',
    text: 'Press Get started. Name it Telegraph, choose External, and give your email. Then, under Audience, add your own email as a test user.',
    url: 'https://console.cloud.google.com/auth/overview'
  },
  {
    title: 'Make a key for Telegraph',
    text: 'Create a client, choose Desktop app as its type, and download the file it offers.',
    url: 'https://console.cloud.google.com/auth/clients/create'
  }
]

function GoogleCard({ status }: { status: GoogleStatus }) {
  const [problem, setProblem] = useState<string | null>(null)

  if (status.state === 'connected') {
    return (
      <div className="card-state is-connected">
        <span>
          <Icon name="check" /> Connected as {status.email}
        </span>
        <button type="button" className="quiet-button" onClick={() => void window.telegraph.disconnectGoogle()}>
          Disconnect
        </button>
      </div>
    )
  }

  const chooseFile = async (): Promise<void> => {
    const { error } = await window.telegraph.importGoogleClient()
    setProblem(error ?? null)
  }

  const connecting = status.state === 'connecting'
  return (
    <div className="card-state">
      <button
        type="button"
        className="primary-button"
        disabled={connecting || status.state === 'unconfigured'}
        onClick={() => void window.telegraph.connectGoogle()}
      >
        {connecting ? 'Waiting for you in the browser…' : 'Connect Google'}
      </button>
      {connecting && <p className="card-hint">Sign in to Google in the browser that opened, then come back.</p>}
      {status.state === 'disconnected' && status.reason && (
        <p className="card-hint is-problem" role="alert">
          {status.reason}
        </p>
      )}
      {status.state === 'unconfigured' && (
        <div className="setup">
          <p className="card-hint">
            Google needs Telegraph to be registered once before it lets you sign in. It takes about ten minutes, and
            only once: after that, Connect Google is all there is to it.
          </p>
          <ol className="setup-steps" aria-label="Setting up Google">
            {SETUP_STEPS.map((step, index) => (
              <li key={step.title}>
                <span className="setup-number" aria-hidden="true">
                  {index + 1}
                </span>
                <div>
                  <h3>{step.title}</h3>
                  <p className="card-hint">{step.text}</p>
                </div>
                <button
                  type="button"
                  className="quiet-button"
                  onClick={() => {
                    window.telegraph.openExternal(step.url)
                    if (step.then) window.telegraph.openExternal(step.then)
                  }}
                >
                  Open
                </button>
              </li>
            ))}
          </ol>
          <button type="button" className="action-button" onClick={() => void chooseFile()}>
            Choose the downloaded file
          </button>
          {problem && (
            <p className="card-hint is-problem" role="alert">
              {problem}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function clockOf(time: string): string {
  const at = new Date(time)
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
}
