import { useEffect, useRef } from 'react'
import { finishRenaming } from '../controller'

/** Where the name of a session is typed, in the place of its name. */
export function NameField({ sessionId, name }: { sessionId: string; name: string }) {
  const field = useRef<HTMLInputElement>(null)
  const done = useRef(false)

  useEffect(() => {
    field.current?.focus()
    field.current?.select()
  }, [])

  const finish = (text: string | null): void => {
    if (done.current) return
    done.current = true
    finishRenaming(sessionId, text)
  }

  return (
    <input
      ref={field}
      className="name-field"
      aria-label="Name of the session"
      defaultValue={name}
      spellCheck={false}
      maxLength={200}
      onKeyDown={(event) => {
        if (event.key === 'Enter') finish(event.currentTarget.value)
        else if (event.key === 'Escape') finish(null)
        // Keys typed here are for the name, not for the window.
        event.stopPropagation()
      }}
      onBlur={(event) => finish(event.currentTarget.value)}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    />
  )
}
