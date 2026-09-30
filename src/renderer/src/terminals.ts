import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { TERMINAL_FONT_FAMILY, TERMINAL_FONT_SIZE, TERMINAL_THEME } from './theme'

// What agents read as "insert a line break" rather than "send".
const LINE_BREAK = '\x1b\r'
const KILL_LINE = '\x15'
const LINE_START = '\x01'
const LINE_END = '\x05'

export interface TerminalHandlers {
  onInput(data: string): void
  onResize(cols: number, rows: number): void
  onBell(): void
  onTitle(title: string): void
  onLink(url: string): void
  /** Files were dropped on the terminal, or pasted into it. */
  onFiles(files: File[]): void
}

interface TerminalView {
  terminal: Terminal
  fit: FitAddon
  element: HTMLDivElement
}

export interface TerminalOptions {
  /** The GPU renderer draws to a canvas, which leaves tests nothing to read. */
  useGpu: boolean
}

/**
 * Owns the terminals outside React. Each one keeps its own element for as
 * long as its session lasts, so nothing it has shown is lost when it is out
 * of sight. A terminal that is shown is placed in a tile of the stage. One
 * that is not waits in the host, which is as large as the stage and hidden.
 */
export class TerminalManager {
  private readonly views = new Map<string, TerminalView>()
  private host: HTMLElement | null = null
  private resizeObserver: ResizeObserver | null = null
  private fitScheduled = false

  constructor(private readonly options: TerminalOptions) {}

  attach(host: HTMLElement): void {
    this.host = host
    this.resizeObserver?.disconnect()
    this.resizeObserver = new ResizeObserver(() => this.scheduleFit())
    this.resizeObserver.observe(host)
    for (const view of this.views.values()) this.resizeObserver.observe(view.element)
  }

  /** Moves a terminal into a tile, or back to the host when it is given none. */
  place(sessionId: string, container: HTMLElement | null): void {
    const view = this.views.get(sessionId)
    const home = container ?? this.host
    if (!view || !home || view.element.parentElement === home) return
    home.append(view.element)
    this.scheduleFit()
    // Moving an element takes the keys from it.
    if (view.element.classList.contains('is-active')) view.terminal.focus()
  }

  create(sessionId: string, handlers: TerminalHandlers): { cols: number; rows: number } {
    if (!this.host) throw new Error('The terminal area is not ready yet')

    const element = document.createElement('div')
    element.className = 'terminal-view'
    element.dataset.sessionId = sessionId
    this.host.append(element)

    const terminal = new Terminal({
      allowProposedApi: true,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: TERMINAL_FONT_SIZE,
      lineHeight: 1.25,
      cursorStyle: 'bar',
      cursorInactiveStyle: 'outline',
      scrollback: 10_000,
      theme: TERMINAL_THEME,
      // Option stays a character key: many keyboard layouts need it to type
      // brackets, braces and the pipe.
      macOptionIsMeta: false
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.loadAddon(new Unicode11Addon())
    terminal.unicode.activeVersion = '11'
    terminal.loadAddon(new WebLinksAddon((_event, url) => handlers.onLink(url)))
    terminal.open(element)
    if (this.options.useGpu) loadGpuRenderer(terminal)
    fit.fit()

    terminal.attachCustomKeyEventHandler((event) => handleKey(event, handlers.onInput))
    takeFiles(element, (files) => {
      terminal.focus()
      handlers.onFiles(files)
    })
    terminal.onData(handlers.onInput)
    terminal.onResize(({ cols, rows }) => handlers.onResize(cols, rows))
    terminal.onBell(handlers.onBell)
    terminal.onTitleChange(handlers.onTitle)

    // Each by its own size: in a tile a terminal is smaller than the stage.
    this.resizeObserver?.observe(element)
    this.views.set(sessionId, { terminal, fit, element })
    return { cols: terminal.cols, rows: terminal.rows }
  }

  show(sessionId: string | null): void {
    for (const [id, view] of this.views) {
      view.element.classList.toggle('is-active', id === sessionId)
    }
    if (sessionId) this.views.get(sessionId)?.terminal.focus()
  }

  write(sessionId: string, data: string): void {
    this.views.get(sessionId)?.terminal.write(data)
  }

  /** Types text the way pasting does, which tells the program that it was not typed. */
  paste(sessionId: string, text: string): void {
    this.views.get(sessionId)?.terminal.paste(text)
  }

  clear(sessionId: string): void {
    this.views.get(sessionId)?.terminal.clear()
  }

  focus(sessionId: string): void {
    this.views.get(sessionId)?.terminal.focus()
  }

  dispose(sessionId: string): void {
    const view = this.views.get(sessionId)
    if (!view) return
    this.resizeObserver?.unobserve(view.element)
    view.terminal.dispose()
    view.element.remove()
    this.views.delete(sessionId)
  }

  private scheduleFit(): void {
    if (this.fitScheduled) return
    this.fitScheduled = true
    requestAnimationFrame(() => {
      this.fitScheduled = false
      for (const view of this.views.values()) view.fit.fit()
    })
  }
}

function loadGpuRenderer(terminal: Terminal): void {
  try {
    const gpu = new WebglAddon()
    // Browsers cap the number of GPU contexts. A terminal that loses its
    // context falls back to the slower built-in renderer.
    gpu.onContextLoss(() => gpu.dispose())
    terminal.loadAddon(gpu)
  } catch {
    // No GPU available, the built-in renderer is already in place.
  }
}

/**
 * Hands over the files that are dropped on the element or pasted into it. The
 * terminal itself only knows what to do with text.
 */
function takeFiles(element: HTMLElement, take: (files: File[]) => void): void {
  const holdsFiles = (transfer: DataTransfer | null): transfer is DataTransfer =>
    transfer !== null && transfer.types.includes('Files')

  // Heard on the way down to the terminal, which would otherwise paste nothing.
  element.addEventListener(
    'paste',
    (event) => {
      const files = [...(event.clipboardData?.files ?? [])]
      if (files.length === 0) return
      event.preventDefault()
      event.stopPropagation()
      take(files)
    },
    true
  )

  // Saying that the files are welcome is what makes the drop happen.
  element.addEventListener('dragover', (event) => {
    if (!holdsFiles(event.dataTransfer)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  })

  element.addEventListener('drop', (event) => {
    if (!holdsFiles(event.dataTransfer)) return
    event.preventDefault()
    take([...event.dataTransfer.files])
  })
}

/** Returns false for keys Telegraph handles itself, which stops the terminal from handling them too. */
function handleKey(event: KeyboardEvent, send: (data: string) => void): boolean {
  const sequence = sequenceFor(event)
  if (sequence === null) return true
  if (event.type === 'keydown') send(sequence)
  event.preventDefault()
  return false
}

function sequenceFor(event: KeyboardEvent): string | null {
  const { key, shiftKey, metaKey, ctrlKey, altKey } = event
  if (key === 'Enter' && shiftKey && !metaKey && !ctrlKey && !altKey) return LINE_BREAK
  if (metaKey && !shiftKey && !ctrlKey && !altKey) {
    if (key === 'Backspace') return KILL_LINE
    if (key === 'ArrowLeft') return LINE_START
    if (key === 'ArrowRight') return LINE_END
  }
  return null
}
