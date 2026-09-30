import { useLayoutEffect, useRef } from 'react'
import { STATUS_LABELS } from '@shared/status'
import { arrange } from '../arrange'
import { addProject, attachTerminalHost, dismissError, toggleLayout } from '../controller'
import { describeGit, shortenPath } from '../format'
import { modelOf, orderedSessions, sessionLabel, type AppState } from '../store'
import { ModelSwitch } from './ModelSwitch'
import { Picker } from './Picker'
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
                <span className="stage-status" data-status={session.status}>
                  {STATUS_LABELS[session.status]}
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
                <p>Choose what to run in this project's folder.</p>
                <Picker
                  key={project.id}
                  project={project}
                  launchers={state.launchers}
                  catalogue={state.catalogue}
                  choice={state.choices[project.id]}
                />
              </>
            ) : (
              <>
                <h1>No projects yet</h1>
                <p>Add a folder to start agents and shells in it.</p>
                <div className="empty-actions">
                  <button type="button" className="action-button" onClick={() => void addProject()}>
                    Add project
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
