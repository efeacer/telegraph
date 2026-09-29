import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { SHELL_LAUNCHER_ID } from '@shared/launchers'
import { modelsFor } from '@shared/models'
import type { Catalogue, Chat, Choice, Launcher, Project } from '@shared/types'
import { listChats, startSession } from '../controller'
import { describeAge } from '../format'
import { Select, type Option } from './Select'

// Values no model and no mode can have.
const USUAL = ''
const ANOTHER = '\u0000another'
const NEW_CHAT = ''
// What is chosen in the blank for the chat is a mode or a chat that was had before.
const MODE = 'mode:'
const CHAT = 'chat:'

interface PickerProps {
  project: Project
  launchers: Launcher[]
  catalogue: Catalogue
  /** What was last chosen in the project. */
  choice: Choice | undefined
}

/** What to start, as a sentence with blanks to fill in. */
export function Picker({ project, launchers, catalogue, choice }: PickerProps) {
  const [launcherId, setLauncherId] = useState(() => firstChoice(launchers, choice))
  const [model, setModel] = useState(() => choice?.models[launcherId] ?? USUAL)
  const [chat, setChat] = useState(NEW_CHAT)
  const [chats, setChats] = useState<Chat[]>([])
  const [typing, setTyping] = useState(false)
  const modelBlank = useRef<HTMLButtonElement>(null)
  const returning = useRef(false)

  // After typing was given up, the blank it stood in for takes the focus back.
  useEffect(() => {
    if (typing || !returning.current) return
    returning.current = false
    modelBlank.current?.focus()
  }, [typing])

  const launcher = launchers.find((candidate) => candidate.id === launcherId) ?? launchers[0]
  const keepsChats = launcher?.chats !== undefined

  // Asked for each time the choice is shown, since chats are had in between.
  useEffect(() => {
    setChats([])
    if (!launcher || !keepsChats) return
    let shown = true
    void listChats(project.id, launcher.id).then((found) => {
      if (shown) setChats(found)
    })
    return () => {
      shown = false
    }
  }, [project.id, launcher?.id, keepsChats])

  if (!launcher) return null

  const models = modelsFor(launcher, catalogue)
  const takesModel = launcher.command !== null && Boolean(launcher.modelFlag)
  const modes = launcher.modes ?? []

  const chooseLauncher = (id: string): void => {
    setLauncherId(id)
    setModel(choice?.models[id] ?? USUAL)
    setChat(NEW_CHAT)
    setTyping(false)
  }

  const chooseModel = (value: string): void => {
    if (value !== ANOTHER) return setModel(value)
    setModel(USUAL)
    setTyping(true)
  }

  const stopTyping = (): void => {
    returning.current = true
    setModel(USUAL)
    setTyping(false)
  }

  const stopTypingOnEscape = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') stopTyping()
  }

  const start = (event: FormEvent): void => {
    event.preventDefault()
    void startSession(project.id, launcher.id, {
      model: takesModel && model.trim() !== '' ? model.trim() : null,
      modeId: chat.startsWith(MODE) ? chat.slice(MODE.length) : null,
      chatId: chat.startsWith(CHAT) ? chat.slice(CHAT.length) : null
    })
  }

  const modelOptions: Option[] = [
    { value: USUAL, label: 'its usual model', group: 'usual' },
    ...models.map(({ id, name }) => ({
      value: id,
      label: name,
      group: 'listed',
      ...(name === id ? {} : { hint: id })
    })),
    // Chosen before and not in any list, such as a model that was typed in.
    ...(model === USUAL || typing || models.some(({ id }) => id === model)
      ? []
      : [{ value: model, label: model, group: 'listed' }]),
    { value: ANOTHER, label: 'another model…', group: 'another' }
  ]

  return (
    <form className="picker" onSubmit={start}>
      <div className="picker-line">
        <Select
          label="Agent"
          value={launcher.id}
          options={launchers.map(({ id, name }) => ({ value: id, label: name }))}
          onChange={chooseLauncher}
        />
        {takesModel && (
          <>
            <span className="picker-word">on</span>
            {typing ? (
              <span className="blank-typing">
                <input
                  className="blank-input"
                  aria-label="Model"
                  placeholder="the name of a model"
                  autoFocus
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  onKeyDown={stopTypingOnEscape}
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Choose from the list"
                  title="Choose from the list"
                  onClick={stopTyping}
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
              </span>
            ) : (
              <Select
                label="Model"
                ref={modelBlank}
                value={model}
                options={modelOptions}
                onChange={chooseModel}
              />
            )}
          </>
        )}
        {(modes.length > 0 || chats.length > 0) && (
          <>
            <span className="picker-word">to</span>
            <Select
              label="Chat"
              value={chat}
              options={[
                { value: NEW_CHAT, label: 'start a new chat', group: 'new' },
                ...modes.map(({ id, name }) => ({ value: `${MODE}${id}`, label: name, group: 'modes' })),
                ...chats.map(({ id, title, at }) => ({
                  value: `${CHAT}${id}`,
                  label: `reopen “${title}”`,
                  alias: title,
                  note: describeAge(at),
                  group: 'chats'
                }))
              ]}
              onChange={setChat}
            />
          </>
        )}
      </div>
      <button type="submit" className="action-button">
        Start {launcher.name}
      </button>
    </form>
  )
}

/** The launcher chosen last, or else the first that runs an agent. */
function firstChoice(launchers: Launcher[], choice: Choice | undefined): string {
  const candidates = [
    launchers.find((launcher) => launcher.id === choice?.launcherId),
    launchers.find((launcher) => launcher.id !== SHELL_LAUNCHER_ID),
    launchers[0]
  ]
  return candidates.find((launcher) => launcher !== undefined)?.id ?? SHELL_LAUNCHER_ID
}
