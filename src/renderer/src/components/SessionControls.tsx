import { pauseSession, resumeSession } from '../controller'
import { sessionLabel, type SessionView } from '../store'
import { Icon } from './Icon'

/**
 * Pause and play for a session. In the header it says what it is; in a row or
 * a tile, where there is little room, it is an icon, and says it when pointed
 * at. The × beside it ends the session; Stop is in the menu, as ⌘.
 */
export function SessionControls({ session, labelled = false }: { session: SessionView; labelled?: boolean }) {
  if (session.status === 'exited') return null
  const label = sessionLabel(session)
  const name = (action: string): string => (labelled ? action : `${action} ${label}`)
  return (
    <span className={labelled ? 'session-controls is-labelled' : 'session-controls'}>
      {session.paused ? (
        <button
          type="button"
          className="control-button"
          aria-label={name('Resume')}
          title={`Resume ${label}: it goes on from where it was paused.`}
          onClick={() => void resumeSession(session.id)}
        >
          <Icon name="play" />
          {labelled && <span>Resume</span>}
        </button>
      ) : (
        <button
          type="button"
          className="control-button"
          aria-label={name('Pause')}
          title={`Freeze ${label} where it is. Resume lets it go on from there.`}
          onClick={() => void pauseSession(session.id)}
        >
          <Icon name="pause" />
          {labelled && <span>Pause</span>}
        </button>
      )}
    </span>
  )
}
