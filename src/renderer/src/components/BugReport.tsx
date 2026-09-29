import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type SyntheticEvent
} from 'react'
import { closeBugReport, saveBugReport } from '../controller'

/** Most bugs do not throw, so the user can write down what they saw. */
export function BugReport() {
  const dialog = useRef<HTMLDialogElement>(null)
  const [note, setNote] = useState('')
  const [failed, setFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  // Read when a save returns, which can be after the dialog has gone.
  const open = useRef(true)
  const inFlight = useRef(false)
  const titleId = useId()
  const fieldId = useId()
  const hintId = useId()

  useEffect(() => {
    open.current = true
    dialog.current?.showModal()
    return () => {
      open.current = false
    }
  }, [])

  // Closing the dialog itself comes first: while it is open, nothing behind
  // it can take the focus back.
  const close = (): void => {
    dialog.current?.close()
    closeBugReport()
  }

  // The dialog would close by itself and say so later, by which time the
  // user may have opened it again.
  const closeOnEscape = (event: SyntheticEvent): void => {
    event.preventDefault()
    close()
  }

  const save = async (): Promise<void> => {
    if (note.trim() === '' || inFlight.current) return
    inFlight.current = true
    setSaving(true)
    const saved = await saveBugReport(note.trim())
    inFlight.current = false
    // Closed in the meantime, and perhaps opened again for another note.
    if (!open.current) return
    setSaving(false)
    if (saved) close()
    else setFailed(true)
  }

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    void save()
  }

  const saveOnCommandEnter = (event: KeyboardEvent): void => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void save()
  }

  return (
    <dialog className="dialog" ref={dialog} aria-labelledby={titleId} onCancel={closeOnEscape}>
      <form onSubmit={submit}>
        <h1 id={titleId}>Report a bug</h1>
        <label htmlFor={fieldId}>What went wrong?</label>
        <textarea
          id={fieldId}
          aria-describedby={hintId}
          rows={6}
          autoFocus
          placeholder="What you did, what you expected, and what happened instead"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          onKeyDown={saveOnCommandEnter}
        />
        <p className="dialog-hint" id={hintId}>
          Saved to the bug log on this computer, with the state of your sessions. Nothing from your
          terminals is included.
        </p>
        {failed && (
          <p className="dialog-error" role="alert">
            The note could not be saved. Copy it somewhere safe before closing.
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="quiet-button" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="action-button" disabled={note.trim() === '' || saving}>
            Save
          </button>
        </div>
      </form>
    </dialog>
  )
}
