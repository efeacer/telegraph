import { STATUS_LABELS } from '@shared/status'
import type { GitStatus, Launcher, Project } from '@shared/types'
import { THEMES, type ThemeName } from '@shared/themes'
import {
  activateSession,
  addProject,
  chooseTheme,
  endSession,
  selectProject,
  startRenaming
} from '../controller'
import { describeGit } from '../format'
import { modelOf, sessionLabel, type AppState, type SessionView } from '../store'
import { NameField } from './NameField'
import { ProjectMenu } from './ProjectMenu'
import { Select } from './Select'
import { Signal } from './Signal'

export function Sidebar({ state }: { state: AppState }) {
  return (
    <aside className="sidebar" aria-label="Projects">
      <div className="titlebar-space" />
      <div className="sidebar-scroll">
        {state.projects.map((project) => (
          <ProjectGroup
            key={project.id}
            project={project}
            launchers={state.launchers}
            git={state.git[project.id] ?? null}
            sessions={state.sessions.filter((session) => session.projectId === project.id)}
            modelOf={(session) => modelOf(state, session)}
            renamingSessionId={state.renaming?.place === 'sidebar' ? state.renaming.sessionId : null}
            activeSessionId={state.activeSessionId}
            selected={state.selectedProjectId === project.id}
          />
        ))}
      </div>
      <div className="sidebar-foot">
        <button type="button" className="quiet-button" onClick={() => void addProject()}>
          Add project
        </button>
        <span className="theme-choice">
          <Select
            label="Theme"
            value={state.theme}
            options={THEMES.map(({ name, label }) => ({ value: name, label }))}
            onChange={(theme) => chooseTheme(theme as ThemeName)}
          />
        </span>
      </div>
    </aside>
  )
}

interface ProjectGroupProps {
  project: Project
  launchers: Launcher[]
  git: GitStatus | null
  sessions: SessionView[]
  activeSessionId: string | null
  selected: boolean
  modelOf(session: SessionView): string | null
  renamingSessionId: string | null
}

function ProjectGroup(props: ProjectGroupProps) {
  const { project, launchers, git, sessions, activeSessionId, selected, modelOf: model, renamingSessionId } = props
  const unread = sessions.filter((session) => session.unread).length
  return (
    <section className={selected ? 'project is-selected' : 'project'}>
      <div className="project-head">
        <button
          type="button"
          className="project-name"
          title={project.path}
          onClick={() => selectProject(project.id)}
        >
          <span className="project-title">
            {project.name}
            {unread > 0 && (
              <span className="project-badge" aria-label={`${unread} with something new`}>
                {unread}
              </span>
            )}
          </span>
          {git && <span className="project-branch">{describeGit(git)}</span>}
        </button>
        <ProjectMenu project={project} launchers={launchers} hasSessions={sessions.length > 0} />
      </div>
      {sessions.length > 0 && (
        <ul className="wire">
          {sessions.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              model={model(session)}
              active={session.id === activeSessionId}
              renaming={session.id === renamingSessionId}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

interface SessionRowProps {
  session: SessionView
  model: string | null
  active: boolean
  renaming: boolean
}

function SessionRow({ session, model, active, renaming }: SessionRowProps) {
  const label = sessionLabel(session)
  return (
    <li className={active ? 'session is-active' : 'session'} data-status={session.status}>
      <button
        type="button"
        className="session-main"
        aria-current={active ? 'true' : undefined}
        onClick={() => activateSession(session.id)}
      >
        <Signal status={session.status} />
        <span className="session-text">
          {renaming ? (
            <NameField sessionId={session.id} name={session.name ?? label} />
          ) : (
            <span
              className="session-title"
              title="Double-click to rename"
              onDoubleClick={() => startRenaming(session.id, 'sidebar')}
            >
              {label}
            </span>
          )}
          <span className="session-status">
            {STATUS_LABELS[session.status]}
            {model && <span className="session-model">{model}</span>}
          </span>
        </span>
        {session.unread && <span className="session-badge" role="img" aria-label="Something new" />}
      </button>
      <button
        type="button"
        className="icon-button session-end"
        aria-label={`End ${label}`}
        onClick={() => void endSession(session.id)}
      >
        <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
          <path
            d="M2.5 2.5l7 7M9.5 2.5l-7 7"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </li>
  )
}
