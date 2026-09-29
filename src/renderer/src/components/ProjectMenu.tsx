import { useEffect, useId, useRef, useState } from 'react'
import type { Launcher, Project } from '@shared/types'
import { removeProject, showPicker, startSession } from '../controller'

interface ProjectMenuProps {
  project: Project
  launchers: Launcher[]
  hasSessions: boolean
}

export function ProjectMenu({ project, launchers, hasSessions }: ProjectMenuProps) {
  const [open, setOpen] = useState(false)
  const container = useRef<HTMLDivElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    const closeOnOutsideClick = (event: MouseEvent): void => {
      if (!container.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', closeOnOutsideClick)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('mousedown', closeOnOutsideClick)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const choose = (action: () => void): void => {
    setOpen(false)
    action()
  }

  return (
    <div className="project-menu" ref={container}>
      <button
        type="button"
        className="icon-button"
        aria-label={`Start a session in ${project.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
          <path d="M6 1.5v9M1.5 6h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div className="menu" id={menuId} role="menu" aria-label={`Sessions in ${project.name}`}>
          {launchers.flatMap((launcher) => [
            <button
              key={launcher.id}
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={() => choose(() => void startSession(project.id, launcher.id))}
            >
              Start {launcher.name}
            </button>,
            ...(launcher.modes ?? []).map((mode) => (
              <button
                key={`${launcher.id} ${mode.id}`}
                type="button"
                role="menuitem"
                className="menu-item"
                onClick={() =>
                  choose(() => void startSession(project.id, launcher.id, { modeId: mode.id }))
                }
              >
                {launcher.name}, {mode.name}
              </button>
            ))
          ])}
          <div className="menu-divider" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => choose(() => showPicker(project.id))}
          >
            Choose a model or a chat…
          </button>
          <div className="menu-divider" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            disabled={hasSessions}
            title={hasSessions ? 'End the sessions in this project first' : undefined}
            onClick={() => choose(() => void removeProject(project.id))}
          >
            Remove project
          </button>
        </div>
      )}
    </div>
  )
}
