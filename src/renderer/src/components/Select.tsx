import { useEffect, useId, useRef, useState, type KeyboardEvent, type Ref } from 'react'

export interface Option {
  value: string
  label: string
  /** Said after the label in smaller letters, such as the name a program knows a model by. */
  hint?: string
  /** Said after the label as well, in the letters of the label: when a chat last went on. */
  note?: string
  /** What else the option is found by when its name is typed, such as a title inside its label. */
  alias?: string
  /** Options of the same group stand together, with a line before the next group. */
  group?: string
}

interface SelectProps {
  /** What the blank is for. Read out, not shown. */
  label: string
  value: string
  options: Option[]
  onChange(value: string): void
  ref?: Ref<HTMLButtonElement>
}

const TYPING_PAUSE_MS = 700
const PAGE = 8

/** A blank in a sentence and the list of what can fill it. */
export function Select({ label, value, options, onChange, ref }: SelectProps) {
  const [open, setOpen] = useState(false)
  // Kept by value: the options can change while the list is open.
  const [activeValue, setActiveValue] = useState(value)
  const list = useRef<HTMLUListElement>(null)
  const typed = useRef({ text: '', at: 0 })
  const listId = useId()

  const selected = options.findIndex((option) => option.value === value)
  const active = Math.max(
    0,
    options.findIndex((option) => option.value === activeValue)
  )

  useEffect(() => {
    if (open) list.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  const show = (): void => {
    setActiveValue(value)
    setOpen(true)
  }

  const choose = (index: number): void => {
    const option = options[index]
    if (option) onChange(option.value)
    setOpen(false)
  }

  const moveTo = (index: number): void => {
    const option = options[Math.min(options.length - 1, Math.max(0, index))]
    if (option) setActiveValue(option.value)
  }

  const isTyping = (at: number): boolean => at - typed.current.at <= TYPING_PAUSE_MS

  /** Moves to the option that starts with what has been typed without a pause. */
  const seek = (character: string, at: number): void => {
    const text = isTyping(at) ? typed.current.text + character : character
    typed.current = { text, at }
    const found = options.findIndex(({ label, alias }) =>
      [label, alias ?? ''].some((name) => name !== '' && name.toLowerCase().startsWith(text))
    )
    if (found === -1) return
    if (open) moveTo(found)
    else onChange(options[found]!.value)
  }

  const handleKey = (event: KeyboardEvent): void => {
    if (event.metaKey || event.ctrlKey) return
    const { key } = event
    // A space is part of a name while one is being typed, and a key of its own otherwise.
    if (key.length === 1 && !event.altKey && (key !== ' ' || isTyping(event.timeStamp))) {
      event.preventDefault()
      seek(key.toLowerCase(), event.timeStamp)
      return
    }
    if (!open) {
      if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ') {
        event.preventDefault()
        show()
      }
      return
    }
    switch (key) {
      case 'ArrowDown':
        moveTo(active + 1)
        break
      case 'ArrowUp':
        moveTo(active - 1)
        break
      case 'PageDown':
        moveTo(active + PAGE)
        break
      case 'PageUp':
        moveTo(active - PAGE)
        break
      case 'Home':
        moveTo(0)
        break
      case 'End':
        moveTo(options.length - 1)
        break
      case 'Enter':
      case ' ':
        choose(active)
        break
      case 'Escape':
        setOpen(false)
        break
      case 'Tab':
        // Takes the option and lets the focus move on.
        choose(active)
        return
      default:
        return
    }
    event.preventDefault()
  }

  return (
    <span className="blank">
      <button
        type="button"
        role="combobox"
        className="blank-value"
        ref={ref}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={handleKey}
        onBlur={() => setOpen(false)}
      >
        {options[selected]?.label ?? value}
        <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
          <path d="M2 3.75 5 6.75l3-3" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      {open && (
        <ul
          className="blank-list"
          id={listId}
          role="listbox"
          aria-label={label}
          ref={list}
          // The button keeps the focus, and with it the keyboard.
          onMouseDown={(event) => event.preventDefault()}
        >
          {options.map((option, index) => (
            <li
              key={option.value}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === selected}
              // Named by its label alone, with the hint as what is said about it.
              aria-label={option.label}
              aria-description={option.hint ?? option.note}
              className={classNames(option, options[index - 1], index === active)}
              onMouseEnter={() => setActiveValue(option.value)}
              onClick={() => choose(index)}
            >
              <span className="blank-option-label">{option.label}</span>
              {option.hint && <span className="blank-option-hint">{option.hint}</span>}
              {option.note && <span className="blank-option-note">{option.note}</span>}
            </li>
          ))}
        </ul>
      )}
    </span>
  )
}

function classNames(option: Option, previous: Option | undefined, active: boolean): string {
  const names = ['blank-option']
  if (active) names.push('is-active')
  if (previous && previous.group !== option.group) names.push('starts-group')
  return names.join(' ')
}
