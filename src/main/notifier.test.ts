import { describe, expect, it, vi } from 'vitest'
import { Notifier, type Banner, type NotifierTools } from './notifier'

const FIRST = '11111111-1111-4111-8111-111111111111'
const SECOND = '22222222-2222-4222-8222-222222222222'

function notice(sessionId = FIRST, title = 'Claude'): Record<string, unknown> {
  return { sessionId, title, body: 'Waiting for you in telegraph' }
}

function setup(changes: Partial<NotifierTools> = {}) {
  const banners: (Banner & { options: { title: string; body: string }; shown: boolean; closed: boolean; click(): void })[] = []
  const tools: NotifierTools = {
    supported: () => true,
    create: (options) => {
      let clicked = (): void => {}
      const banner = {
        options,
        shown: false,
        closed: false,
        show: () => void (banner.shown = true),
        close: () => void (banner.closed = true),
        onClick: (listener: () => void) => void (clicked = listener),
        click: () => clicked()
      }
      banners.push(banner)
      return banner
    },
    setBadge: vi.fn(),
    ...changes
  }
  const opened: string[] = []
  const notifier = new Notifier(tools, (sessionId) => opened.push(sessionId))
  return { notifier, tools, banners, opened }
}

describe('Notifier', () => {
  it('shows what the window has to say', () => {
    const { notifier, banners } = setup()
    notifier.notify(notice())
    expect(banners).toHaveLength(1)
    expect(banners[0]).toMatchObject({ shown: true, options: { title: 'Claude', body: 'Waiting for you in telegraph' } })
  })

  it('opens the session whose notice was pressed', () => {
    const { notifier, banners, opened } = setup()
    notifier.notify(notice(FIRST))
    notifier.notify(notice(SECOND))
    banners[1]!.click()
    expect(opened).toEqual([SECOND])
  })

  it('shows one notice for a session, the last', () => {
    const { notifier, banners } = setup()
    notifier.notify(notice(FIRST, 'before'))
    notifier.notify(notice(FIRST, 'after'))
    expect(banners.map((banner) => banner.closed)).toEqual([true, false])
  })

  it('takes back the notice of a session the user has gone to', () => {
    const { notifier, banners } = setup()
    notifier.notify(notice(FIRST))
    notifier.notify(notice(SECOND))
    notifier.withdraw(FIRST)
    expect(banners.map((banner) => banner.closed)).toEqual([true, false])
    expect(() => notifier.withdraw(FIRST)).not.toThrow()
    expect(() => notifier.withdraw(42)).not.toThrow()
  })

  it('takes back everything when the window starts over', () => {
    const { notifier, banners, tools } = setup()
    notifier.notify(notice(FIRST))
    notifier.notify(notice(SECOND))
    notifier.clear()
    expect(banners.map((banner) => banner.closed)).toEqual([true, true])
    expect(tools.setBadge).toHaveBeenLastCalledWith(0)
    expect(() => notifier.clear()).not.toThrow()
  })

  it('shows an offer of its own, and does what it offers when pressed', () => {
    const { notifier, banners } = setup()
    const taken = vi.fn()
    notifier.offer('meeting', { title: '“Design review” in 30 minutes', body: 'Want help?' }, taken)
    expect(banners[0]).toMatchObject({ shown: true, options: { title: '“Design review” in 30 minutes' } })
    banners[0]!.click()
    expect(taken).toHaveBeenCalledOnce()
  })

  it('keeps its own offers when the window starts over, which knows nothing of them', () => {
    const { notifier, banners } = setup()
    notifier.offer('meeting a', { title: 'Soon', body: 'Help?' }, () => {})
    notifier.notify(notice(FIRST))
    notifier.clear()
    expect(banners.map((banner) => banner.closed)).toEqual([false, true])
  })

  it('shows nothing of what is not a notice', () => {
    const { notifier, banners } = setup()
    notifier.notify({ sessionId: FIRST })
    notifier.notify('waiting')
    notifier.notify(null)
    expect(banners).toEqual([])
  })

  it('shows nothing where the system shows no notices', () => {
    const { notifier, banners } = setup({ supported: () => false })
    notifier.notify(notice())
    expect(banners).toEqual([])
  })

  it('carries on when a notice cannot be shown', () => {
    const { notifier } = setup({
      create: () => {
        throw new Error('no notification service')
      }
    })
    expect(() => notifier.notify(notice())).not.toThrow()
  })

  it('counts on the icon how many sessions wait', () => {
    const { notifier, tools } = setup()
    notifier.badge(3)
    notifier.badge(0)
    expect(tools.setBadge).toHaveBeenNthCalledWith(1, 3)
    expect(tools.setBadge).toHaveBeenNthCalledWith(2, 0)
  })

  it('counts nothing that is not a count', () => {
    const { notifier, tools } = setup()
    for (const value of [-1, 1.5, '3', null, Number.NaN, 1e9]) notifier.badge(value)
    expect(tools.setBadge).not.toHaveBeenCalled()
  })

  it('carries on when the icon cannot be marked', () => {
    const { notifier } = setup({
      setBadge: () => {
        throw new Error('no dock')
      }
    })
    expect(() => notifier.badge(2)).not.toThrow()
  })
})
