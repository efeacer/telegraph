import type { GitStatus, Launcher, Project } from '@shared/types'
import { THEMES, type ThemeName } from '@shared/themes'
import type { AgendaState } from '@shared/types'
import {
  activateSession,
  addProject,
  chooseTheme,
  openConnections,
  endSession,
  selectProject,
  startRenaming
} from '../controller'
import { describeGit, describeMeetingTime } from '../format'
import { modelOf, sessionLabel, statusLabel, type AppState, type SessionView } from '../store'
import { Icon } from './Icon'
import { NameField } from './NameField'
import { ProjectMenu } from './ProjectMenu'
import { Select } from './Select'
import { SessionControls } from './SessionControls'
import { Signal } from './Signal'

export function Sidebar({ state }: { state: AppState }) {
  return (
    <aside className="sidebar" aria-label="Projects">
      <div className="titlebar-space" />
      <div className="sidebar-scroll">
        {state.projects
          .filter((project) => !project.companion || state.companionHost)
          .map((project) => (
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
            agenda={project.companion ? state.agenda : null}
          />
        ))}
      </div>
      <div className="sidebar-foot">
        <button type="button" className="foot-button" onClick={() => void addProject()} title="Add a folder to work in">
          <Icon name="plus" /> Add project
        </button>
        <button type="button" className="foot-button" onClick={openConnections} title="Connect your calendar and mail">
          <Icon name="plug" /> Connections
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

/** What the file manager of the system is called, which the user knows it by. */
const FILE_MANAGER = navigator.userAgent.includes('Windows')
  ? 'File Explorer'
  : navigator.userAgent.includes('Mac')
    ? 'Finder'
    : 'Files'

/** What the companion knows of the day, under its name. Pressed, it shows what it is connected to. */
function NextMeeting({ agenda }: { agenda: AgendaState | null }) {
  const now = Date.now()
  const next = agenda?.meetings.find((meeting) => !meeting.allDay && Date.parse(meeting.end) > now)
  const needsSignIn = agenda?.status === 'unavailable' && !next
  const text = next
    ? `Next: ${next.title} ${describeMeetingTime(next.start)}`
    : needsSignIn
      ? 'Calendar needs signing in'
      : agenda?.status === 'reading' || agenda === null
        ? 'Reading the calendar…'
        : agenda.status === 'failed'
          ? 'Calendar could not be read'
          : 'No more meetings today'
  return (
    <button
      type="button"
      className={needsSignIn ? 'companion-next needs-attention' : 'companion-next'}
      title="Connections"
      onClick={openConnections}
    >
      {text}
    </button>
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
  /** For the companion: the meetings, of which the next is shown under its name. */
  agenda: AgendaState | null
}

function ProjectGroup(props: ProjectGroupProps) {
  const { project, launchers, git, sessions, activeSessionId, selected, modelOf: model, renamingSessionId, agenda } = props
  const unread = sessions.filter((session) => session.unread).length
  return (
    <section className={['project', selected && 'is-selected', project.companion && 'is-companion'].filter(Boolean).join(' ')}>
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
        <button
          type="button"
          className="icon-button project-folder"
          aria-label={`Open ${project.name} in ${FILE_MANAGER}`}
          title={`Open the folder of ${project.name} in ${FILE_MANAGER}`}
          onClick={() => window.telegraph.openFolder(project.id)}
        >
          <Icon name="folder" size={14} />
        </button>
        <ProjectMenu project={project} launchers={launchers} hasSessions={sessions.length > 0} />
      </div>
      {project.companion && <NextMeeting agenda={agenda} />}
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
  const Main = renaming ? 'div' : 'button'
  const label = sessionLabel(session)
  return (
    <li
      className={active ? 'session is-active' : 'session'}
      data-status={session.status}
      data-paused={session.paused || undefined}
    >
      {/* While its name is typed the row is no button: a button takes Space for a press, and the name would end at the first word. */}
      <Main
        className="session-main"
        {...(renaming
          ? {}
          : { type: 'button', 'aria-current': active ? 'true' : undefined, onClick: () => activateSession(session.id) })}
      >
        <Signal status={session.status} paused={session.paused} />
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
            {statusLabel(session)}
            {model && <span className="session-model">{model}</span>}
          </span>
        </span>
        {session.unread && <span className="session-badge" role="img" aria-label="Something new" />}
      </Main>
      <SessionControls session={session} />
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
