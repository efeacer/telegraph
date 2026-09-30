import { pauseSession, resumeSession, stopSession } from '../controller'
import { sessionLabel, type SessionView } from '../store'
import { Icon } from './Icon'

/**
 * Pause and play, and stop, for a session. In the header they say what they
 * are; in a row or a tile, where there is little room, they are icons, and
 * say it when pointed at.
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
      <button
        type="button"
        className="control-button"
        aria-label={name('Stop')}
        title={`Stop what ${label} is doing, as Esc does. The session stays open.`}
        onClick={() => void stopSession(session.id)}
      >
        <Icon name="stop" size={14} />
        {labelled && <span>Stop</span>}
      </button>
    </span>
  )
}
