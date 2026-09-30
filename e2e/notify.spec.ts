import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { createWorkspace, launch, removeWorkspace, start, type Workspace } from './telegraph'

let workspace: Workspace
let app: ElectronApplication
let page: Page

test.beforeEach(async () => {
  workspace = createWorkspace()
  ;({ app, page } = await launch(workspace))
})

test.afterEach(async () => {
  await app.close()
  removeWorkspace(workspace)
})

interface Shown {
  title: string
  body: string
  closed: boolean
}

/** The notices the app would have shown. Under test it keeps them to itself. */
function notices(): Promise<Shown[]> {
  return app.evaluate(() =>
    ((globalThis as Record<string, unknown>).telegraphNotices as { title: string; body: string; closed: boolean }[]).map(
      ({ title, body, closed }) => ({ title, body, closed })
    )
  )
}

function pressNotice(index: number): Promise<void> {
  return app.evaluate((_electron, at) => {
    ;((globalThis as Record<string, unknown>).telegraphNotices as { press(): void }[])[at]!.press()
  }, index)
}

function countOnIcon(): Promise<number> {
  return app.evaluate(() => (globalThis as Record<string, unknown>).telegraphBadge as number)
}

function rows(): ReturnType<Page['locator']> {
  return page.locator('.session')
}

async function type(text: string): Promise<void> {
  await page.locator('.terminal-view.is-active .xterm-helper-textarea').focus()
  await expect(page.locator('.terminal-view.is-active .xterm-rows')).toContainText('$')
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
}

/** Starts a second session, which leaves the first one unwatched. */
async function lookAway(): Promise<void> {
  const before = await rows().count()
  await page.getByRole('button', { name: 'Start a session in signal-box' }).click()
  await page.getByRole('menuitem', { name: 'Start Shell' }).click()
  await expect(rows()).toHaveCount(before + 1)
}

const WORK = 'for i in 1 2 3 4 5 6 7 8 9 10 11 12; do echo tick $i; sleep 0.2; done'

test('tells of a session that stops working while the user is elsewhere', async () => {
  await start(page, 'Shell')
  await type(`sleep 1; ${WORK}`)
  await lookAway()

  const first = rows().first()
  await expect(first).toHaveAttribute('data-status', 'attention', { timeout: 15_000 })
  await expect(first.locator('.session-badge')).toBeVisible()
  await expect(rows().last().locator('.session-badge')).toHaveCount(0)
  await expect(page.locator('.project-badge')).toHaveText('1')

  await expect.poll(notices).toEqual([{ title: 'Shell', body: 'Waiting for you in signal-box', closed: false }])
  expect(await countOnIcon()).toBe(1)
})

test('keeps the session marked until the user goes to it', async () => {
  await start(page, 'Shell')
  await type(`sleep 1; ${WORK}`)
  await lookAway()
  const first = rows().first()
  await expect(first.locator('.session-badge')).toBeVisible({ timeout: 15_000 })

  // Still marked a good while later.
  await page.waitForTimeout(1500)
  await expect(first.locator('.session-badge')).toBeVisible()

  await first.locator('.session-main').click()
  await expect(first.locator('.session-badge')).toHaveCount(0)
  await expect(page.locator('.project-badge')).toHaveCount(0)
  await expect.poll(countOnIcon).toBe(0)
  // The notice is taken back too: what it told of has been seen.
  await expect.poll(async () => (await notices())[0]?.closed).toBe(true)
})

test('goes to the session whose notice is pressed', async () => {
  await start(page, 'Shell')
  await type(`echo first-$((1 + 1)); sleep 1; ${WORK}`)
  await lookAway()
  await expect.poll(notices, { timeout: 15_000 }).toHaveLength(1)
  await expect(rows().last()).toHaveClass(/is-active/)

  await pressNotice(0)
  await expect(rows().first()).toHaveClass(/is-active/)
  await expect(page.locator('.terminal-view.is-active .xterm-rows')).toContainText('first-2')
  await expect(rows().first().locator('.session-badge')).toHaveCount(0)
})

test('tells of a session that ended unseen', async () => {
  await start(page, 'Shell')
  await type('sleep 2; exit')
  await lookAway()

  const first = rows().first()
  await expect(first).toHaveAttribute('data-status', 'exited', { timeout: 15_000 })
  await expect(first.locator('.session-badge')).toBeVisible()
  await expect.poll(notices).toEqual([{ title: 'Shell', body: 'Ended in signal-box', closed: false }])
})

test('tells of a session that rings its bell', async () => {
  await start(page, 'Shell')
  await type(`sleep 2; printf '\\a'`)
  await lookAway()

  await expect(rows().first().locator('.session-badge')).toBeVisible({ timeout: 15_000 })
  await expect.poll(notices).toHaveLength(1)
})

test('says nothing of the session in front', async () => {
  await start(page, 'Shell')
  await type(WORK)
  await expect(rows().first()).toHaveAttribute('data-status', 'working')
  await expect(rows().first()).toHaveAttribute('data-status', 'idle', { timeout: 15_000 })

  await expect(page.locator('.session-badge')).toHaveCount(0)
  expect(await notices()).toEqual([])
  expect(await countOnIcon()).toBe(0)
})

test('counts the sessions that wait, and forgets the ones that are ended', async () => {
  await start(page, 'Shell')
  await type(`sleep 1; ${WORK}`)
  await lookAway()
  await type(`sleep 1; ${WORK}`)
  await lookAway()
  await expect(page.locator('.project-badge')).toHaveText('2', { timeout: 20_000 })
  await expect.poll(countOnIcon).toBe(2)

  await rows().first().hover()
  await rows().first().getByRole('button', { name: /^End / }).click()
  await expect(rows()).toHaveCount(2)
  await expect(page.locator('.project-badge')).toHaveText('1')
  await expect.poll(countOnIcon).toBe(1)
})

test('forgets what it told of when the window starts over', async () => {
  await start(page, 'Shell')
  await type(`sleep 1; ${WORK}`)
  await lookAway()
  await expect.poll(countOnIcon, { timeout: 15_000 }).toBe(1)

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.reload())
  await expect(page.getByRole('combobox', { name: 'Agent' })).toBeVisible()
  await expect.poll(countOnIcon).toBe(0)
  expect((await notices()).every((notice) => notice.closed)).toBe(true)
})
