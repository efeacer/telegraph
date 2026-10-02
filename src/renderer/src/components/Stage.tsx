import { useLayoutEffect, useRef } from 'react'
import { arrange } from '../arrange'
import { addProject, attachTerminalHost, chooseAttachments, dismissError, openConnections, toggleLayout } from '../controller'
import { describeGit, shortenPath } from '../format'
import { modelOf, orderedSessions, sessionLabel, statusLabel, type AppState } from '../store'
import { ModelSwitch } from './ModelSwitch'
import { Icon, type IconName } from './Icon'
import { Picker } from './Picker'
import { SessionControls } from './SessionControls'
import { Tile } from './Tile'
import { Usage } from './Usage'

export function Stage({ state }: { state: AppState }) {
  const host = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (host.current) attachTerminalHost(host.current)
  }, [])

  const project = state.projects.find((candidate) => candidate.id === state.selectedProjectId)
  const session = state.sessions.find((candidate) => candidate.id === state.activeSessionId)
  const git = project ? state.git[project.id] : null
  const hasSessions = state.sessions.some((candidate) => candidate.projectId === project?.id)
  const sideBySide = state.layout === 'grid'
  const shown = sideBySide ? orderedSessions(state) : session ? [session] : []
  const { columns, spans } = arrange(shown.length)

  return (
    <main className="stage">
      <header className="stage-header">
        {project && (
          <>
            <div className="stage-title">
              <span className="stage-project">{project.name}</span>
              {session && <span className="stage-session">{sessionLabel(session)}</span>}
              {session && <ModelSwitch state={state} session={session} />}
              {session && (
                <span className="stage-status" data-status={session.paused ? 'paused' : session.status}>
                  {statusLabel(session)}
                </span>
              )}
              {session && <SessionControls session={session} labelled />}
              {session && session.status !== 'exited' && (
                <span className="session-controls is-labelled">
                  <button
                    type="button"
                    className="control-button"
                    title="Hand files or folders to the session, for it to read. Dropping or pasting them on it does the same."
                    onClick={() => void chooseAttachments(session.id)}
                  >
                    <Icon name="attach" />
                    <span>Attach</span>
                  </button>
                </span>
              )}
            </div>
            <div className="stage-meta">
              {git && <span>{describeGit(git)}</span>}
              <span className="stage-path">{shortenPath(project.path)}</span>
            </div>
          </>
        )}
        <button
          type="button"
          className="layout-toggle"
          aria-label="Show sessions side by side"
          aria-pressed={sideBySide}
          title={sideBySide ? 'Show one session at a time' : 'Show sessions side by side'}
          onClick={toggleLayout}
        >
          <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
            <path
              d="M1.75 1.75h4.5v4.5h-4.5zM7.75 1.75h4.5v4.5h-4.5zM1.75 7.75h4.5v4.5h-4.5zM7.75 7.75h4.5v4.5h-4.5z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.25"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <Usage
          usage={state.usage}
          session={(session && state.usage?.sessions[session.id]) ?? null}
        />
      </header>

      {state.error && (
        <div className="notice" role="alert">
          <span>{state.error}</span>
          <button type="button" className="quiet-button" onClick={dismissError}>
            Dismiss
          </button>
        </div>
      )}

      <div className="stage-body">
        <div className="terminal-host" ref={host} />
        {shown.length > 0 && (
          <div
            // While something is being chosen to start, the choice has the stage to itself. The tiles
            // stay where they are underneath: taken away, every terminal would be told of a new size.
            className={['tiles', sideBySide && 'is-grid', !session && 'is-covered'].filter(Boolean).join(' ')}
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(${sideBySide ? '200px' : '0'}, 1fr))` }}
          >
            {shown.map((shownSession, index) => (
              <Tile
                key={shownSession.id}
                session={shownSession}
                model={modelOf(state, shownSession)}
                project={
                  state.projects.find((candidate) => candidate.id === shownSession.projectId)?.name ?? ''
                }
                active={shownSession.id === state.activeSessionId}
                framed={sideBySide}
                span={spans[index] ?? 1}
                renaming={
                  sideBySide &&
                  state.renaming?.place === 'tile' &&
                  state.renaming.sessionId === shownSession.id
                }
              />
            ))}
          </div>
        )}
        {state.loaded && !session && (
          <div className="empty">
            {project ? (
              <>
                <h1>
                  {hasSessions ? 'Start a session in ' : 'No session open in '}
                  {project.name}
                </h1>
                <p>Choose an agent to work with in this folder, or a shell to type commands yourself.</p>
                <Picker
                  key={project.id}
                  project={project}
                  launchers={state.launchers}
                  catalogue={state.catalogue}
                  choice={state.choices[project.id]}
                />
              </>
            ) : (
              <Welcome />
            )}
          </div>
        )}
      </div>
    </main>
  )
}

const STEPS: { icon: IconName; title: string; text: string; action: string; run(): void }[] = [
  {
    icon: 'folder',
    title: 'Add a project',
    text: 'A project is a folder you work in: code, documents, anything. Agents work inside it.',
    action: 'Add a project',
    run: () => void addProject()
  },
  {
    icon: 'sparkle',
    title: 'Start an agent',
    text: 'Pick an agent such as Claude, and tell it what you need in plain words. Pause, stop or end it any time.',
    action: 'Add a project first',
    run: () => void addProject()
  },
  {
    icon: 'calendar',
    title: 'Connect Google',
    text: 'Optional. Your companion then knows your meetings and mail, and offers help before a meeting.',
    action: 'Connect Google',
    run: openConnections
  }
]

/** What someone new sees: what Telegraph is, and what to do first, one step at a time. */
function Welcome() {
  return (
    <div className="welcome">
      <h1>Welcome to Telegraph</h1>
      <p>A place to work with AI agents on your projects, and a companion that knows your day.</p>
      <ol className="welcome-steps" aria-label="Getting started">
        {STEPS.map((step, index) => (
          <li key={step.title}>
            <span className="welcome-mark" aria-hidden="true">
              <Icon name={step.icon} />
            </span>
            <div>
              <h2>{step.title}</h2>
              <p>{step.text}</p>
              {index !== 1 && (
                <button type="button" className={index === 0 ? 'primary-button' : 'action-button'} onClick={step.run}>
                  {step.action}
                </button>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}
