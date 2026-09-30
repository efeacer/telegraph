import { checkNotice } from '@shared/notices'

const MOST_COUNTED = 9999

/** A notice on the screen. */
export interface Banner {
  show(): void
  close(): void
  onClick(listener: () => void): void
}

/** What the system does for the notifier, given to it so that the rest can be tried out without it. */
export interface NotifierTools {
  /** False where the system shows no notices at all. */
  supported(): boolean
  create(options: { title: string; body: string }): Banner
  /** Marks the icon of the app with how many sessions wait. Zero takes the mark away. */
  setBadge(count: number): void
}

/**
 * Tells the user of sessions they are not looking at, by a notice of the
 * system and a count on the icon of the app. Nothing here throws: a notice
 * that cannot be shown is one notice less, and the session is marked in the
 * window all the same.
 */
export class Notifier {
  private readonly shown = new Map<string, Banner>()

  constructor(
    private readonly tools: NotifierTools,
    private readonly onOpen: (sessionId: string) => void
  ) {}

  /** Shows a notice the window asks for. A session has one notice at a time, the last. */
  notify(value: unknown): void {
    const notice = checkNotice(value)
    if (notice === null) return
    try {
      if (!this.tools.supported()) return
      this.withdraw(notice.sessionId)
      const banner = this.tools.create({ title: notice.title, body: notice.body })
      banner.onClick(() => this.onOpen(notice.sessionId))
      banner.show()
      this.shown.set(notice.sessionId, banner)
    } catch {
      // Not shown.
    }
  }

  /** Takes back the notice of a session, which the user has gone to or which is no more. */
  withdraw(sessionId: unknown): void {
    if (typeof sessionId !== 'string') return
    const banner = this.shown.get(sessionId)
    if (!banner) return
    this.shown.delete(sessionId)
    try {
      banner.close()
    } catch {
      // Gone already.
    }
  }

  /** Takes back everything: the window has started over, and the sessions it told of are no more. */
  clear(): void {
    for (const sessionId of [...this.shown.keys()]) this.withdraw(sessionId)
    this.badge(0)
  }

  badge(count: unknown): void {
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0 || count > MOST_COUNTED) {
      return
    }
    try {
      this.tools.setBadge(count)
    } catch {
      // The icon stays as it is.
    }
  }
}
