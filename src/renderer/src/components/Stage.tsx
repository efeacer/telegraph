import { useLayoutEffect, useRef } from 'react'
import { STATUS_LABELS } from '@shared/status'
import { addProject, attachTerminalHost, dismissError, startSession } from '../controller'
import { describeGit, shortenPath } from '../format'
import { sessionLabel, type AppState } from '../store'

export function Stage({ state }: { state: AppState }) {
  const host = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (host.current) attachTerminalHost(host.current)
  }, [])

  const project = state.projects.find((candidate) => candidate.id === state.selectedProjectId)
  const session = state.sessions.find((candidate) => candidate.id === state.activeSessionId)
  const git = project ? state.git[project.id] : null

  return (
    <main className="stage">
      <header className="stage-header">
        {project && (
          <>
            <div className="stage-title">
              <span className="stage-project">{project.name}</span>
              {session && <span className="stage-session">{sessionLabel(session)}</span>}
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
        {state.loaded && !session && (
          <div className="empty">
            {project ? (
              <>
                <h1>No session open in {project.name}</h1>
                <p>Start one to run an agent or a shell in this project's folder.</p>
                <div className="empty-actions">
                  {state.launchers.map((launcher) => (
                    <button
                      key={launcher.id}
                      type="button"
                      className="action-button"
                      onClick={() => void startSession(project.id, launcher.id)}
                    >
                      Start {launcher.name}
                    </button>
                  ))}
                </div>
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
