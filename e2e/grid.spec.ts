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

function tiles(): ReturnType<Page['locator']> {
  return page.locator('.tile')
}

function sideBySide(): ReturnType<Page['locator']> {
  return page.getByRole('button', { name: 'Show sessions side by side' })
}

async function type(text: string): Promise<void> {
  await page.locator('.terminal-view.is-active .xterm-helper-textarea').focus()
  await expect(page.locator('.terminal-view.is-active .xterm-rows')).toContainText('$')
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
}

async function another(): Promise<void> {
  const before = await page.locator('.session').count()
  await page.getByRole('button', { name: 'Start a session in signal-box' }).click()
  await page.getByRole('menuitem', { name: 'Start Shell' }).click()
  await expect(page.locator('.session')).toHaveCount(before + 1)
}

/** Two sessions that have each said something of their own. */
async function twoSessions(): Promise<void> {
  await start(page, 'Shell')
  await type('echo "first $((1 + 1))"')
  await another()
  await type('echo "second $((2 + 2))"')
  await expect(page.locator('.terminal-view.is-active .xterm-rows')).toContainText('second 4')
}

test('shows one session at a time unless asked otherwise', async () => {
  await twoSessions()
  await expect(tiles()).toHaveCount(1)
  await expect(sideBySide()).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByText('first 2')).toBeHidden()
})

test('shows the sessions side by side', async () => {
  await twoSessions()
  await sideBySide().click()

  await expect(sideBySide()).toHaveAttribute('aria-pressed', 'true')
  await expect(tiles()).toHaveCount(2)
  await expect(tiles().nth(0).locator('.xterm-rows')).toContainText('first 2')
  await expect(tiles().nth(1).locator('.xterm-rows')).toContainText('second 4')
  await expect(tiles().nth(0).locator('.xterm-rows')).toBeVisible()
  await expect(tiles().nth(1).locator('.xterm-rows')).toBeVisible()

  // Next to each other, and neither on top of the other.
  const [left, right] = [await tiles().nth(0).boundingBox(), await tiles().nth(1).boundingBox()]
  expect(left!.x + left!.width).toBeLessThanOrEqual(right!.x + 1)
  expect(Math.abs(left!.y - right!.y)).toBeLessThan(2)
})

test('says which session each tile is, and which the keys go to', async () => {
  await twoSessions()
  await sideBySide().click()

  await expect(tiles().nth(0).locator('.tile-head')).toContainText('Shell')
  await expect(tiles().nth(1)).toHaveClass(/is-active/)
  await expect(tiles().nth(0)).not.toHaveClass(/is-active/)
  await expect(tiles().nth(1).locator('.xterm-helper-textarea')).toBeFocused()
})

test('types into the tile that was pressed', async () => {
  await twoSessions()
  await sideBySide().click()
  await tiles().nth(0).locator('.tile-body').click()
  await expect(tiles().nth(0)).toHaveClass(/is-active/)

  await page.keyboard.type('echo "into the first $((3 + 3))"')
  await page.keyboard.press('Enter')
  await expect(tiles().nth(0).locator('.xterm-rows')).toContainText('into the first 6')
  await expect(tiles().nth(1).locator('.xterm-rows')).not.toContainText('into the first')
  await expect(page.locator('.session').first()).toHaveClass(/is-active/)
})

test('fits each terminal to its tile', async () => {
  await start(page, 'Shell')
  await type('echo "wide: $(stty size | cut -d" " -f2)"')
  const rows = page.locator('.terminal-view.is-active .xterm-rows')
  await expect(rows).toContainText(/wide: \d+/)
  const wide = Number(/wide: (\d+)/.exec(await rows.innerText())![1])

  await another()
  await sideBySide().click()
  await expect(tiles()).toHaveCount(2)
  await tiles().nth(0).locator('.tile-body').click()
  await page.keyboard.type('echo "narrow: $(stty size | cut -d" " -f2)"')
  await page.keyboard.press('Enter')
  const first = tiles().nth(0).locator('.xterm-rows')
  await expect(first).toContainText(/narrow: \d+/)
  const narrow = Number(/narrow: (\d+)/.exec(await first.innerText())![1])

  expect(narrow).toBeLessThan(wide * 0.6)
  expect(narrow).toBeGreaterThan(wide * 0.35)
})

test('lets a third session fill the row under the first two', async () => {
  await twoSessions()
  await another()
  await sideBySide().click()
  await expect(tiles()).toHaveCount(3)

  const boxes = await Promise.all([0, 1, 2].map((index) => tiles().nth(index).boundingBox()))
  expect(boxes[2]!.y).toBeGreaterThan(boxes[0]!.y + boxes[0]!.height - 2)
  expect(boxes[2]!.width).toBeGreaterThan(boxes[0]!.width * 1.8)
})

test('goes back to one session at a time', async () => {
  await twoSessions()
  await sideBySide().click()
  await expect(tiles()).toHaveCount(2)
  await sideBySide().click()

  await expect(tiles()).toHaveCount(1)
  await expect(page.locator('.tile-head')).toHaveCount(0)
  await expect(page.locator('.terminal-view.is-active .xterm-rows')).toContainText('second 4')
  await expect(page.locator('.terminal-view.is-active .xterm-helper-textarea')).toBeFocused()
  // What was said before is still there: the terminals were moved, not made anew.
  await page.locator('.session').first().locator('.session-main').click()
  await expect(page.locator('.terminal-view.is-active .xterm-rows')).toContainText('first 2')
})

test('ends a session from its tile', async () => {
  await twoSessions()
  await sideBySide().click()
  await tiles().nth(0).getByRole('button', { name: /^End / }).click()

  await expect(tiles()).toHaveCount(1)
  await expect(page.locator('.session')).toHaveCount(1)
  await expect(tiles().nth(0).locator('.xterm-rows')).toContainText('second 4')
})

test('keeps the keys where they were when another tile is ended', async () => {
  await twoSessions()
  await another()
  await type('echo "third $((3 + 3))"')
  await sideBySide().click()
  await expect(tiles()).toHaveCount(3)
  await expect(tiles().nth(2)).toHaveClass(/is-active/)

  await tiles().nth(0).getByRole('button', { name: /^End / }).click()
  await expect(tiles()).toHaveCount(2)
  await expect(tiles().nth(1)).toHaveClass(/is-active/)
  await expect(tiles().nth(1).locator('.xterm-rows')).toContainText('third 6')
  await expect(tiles().nth(1).locator('.xterm-helper-textarea')).toBeFocused()
})

test('keeps the keys in a tile whose head is pressed', async () => {
  await twoSessions()
  await sideBySide().click()
  await tiles().nth(0).locator('.tile-title').click()

  await expect(tiles().nth(0)).toHaveClass(/is-active/)
  await expect(tiles().nth(0).locator('.xterm-helper-textarea')).toBeFocused()
  await tiles().nth(0).locator('.tile-title').click()
  await expect(tiles().nth(0).locator('.xterm-helper-textarea')).toBeFocused()
})

test('takes the tile that has the keys for the one in front', async () => {
  await twoSessions()
  await sideBySide().click()
  await expect(tiles().nth(1)).toHaveClass(/is-active/)

  // The keys can get to a tile without it being pressed, as when a file is dropped on it.
  await tiles().nth(0).locator('.xterm-helper-textarea').focus()
  await expect(tiles().nth(0)).toHaveClass(/is-active/)
  await expect(page.locator('.session').first()).toHaveClass(/is-active/)
})

test('leaves the terminals as they are while something is chosen to start', async () => {
  await twoSessions()
  await sideBySide().click()
  await tiles().nth(0).locator('.tile-body').click()
  await page.keyboard.type('echo "before: $(stty size)"')
  await page.keyboard.press('Enter')
  const first = tiles().nth(0).locator('.xterm-rows')
  await expect(first).toContainText(/before: \d+ \d+/)
  const before = /before: (\d+ \d+)/.exec(await first.innerText())![1]

  await page.getByRole('button', { name: 'Start a session in signal-box' }).click()
  await page.getByRole('menuitem', { name: 'Choose a model or a chat…' }).click()
  await expect(page.getByRole('combobox', { name: 'Agent' })).toBeVisible()
  await expect(tiles().first()).toBeHidden()
  // Told of a new size, the shell would say so when asked.
  await page.waitForTimeout(400)
  await page.locator('.session').first().locator('.session-main').click()
  await page.keyboard.type('echo "after: $(stty size)"')
  await page.keyboard.press('Enter')
  await expect(first).toContainText(`after: ${before}`)
})

test('keeps the head of a tile inside the tile when there is little room', async () => {
  await twoSessions()
  for (let more = 0; more < 3; more++) await another()
  await sideBySide().click()
  await page.setViewportSize({ width: 760, height: 440 })
  await expect(tiles()).toHaveCount(5)

  for (let index = 0; index < 5; index++) {
    const tile = (await tiles().nth(index).boundingBox())!
    const end = (await tiles().nth(index).getByRole('button', { name: /^End / }).boundingBox())!
    expect(end.x + end.width, `End of tile ${index}`).toBeLessThanOrEqual(tile.x + tile.width + 0.5)
    expect(tile.height, `height of tile ${index}`).toBeGreaterThanOrEqual(140)
    expect(tile.width, `width of tile ${index}`).toBeGreaterThanOrEqual(200)
  }
})

test('stays the way it was left', async () => {
  await sideBySide().click()
  await expect(sideBySide()).toHaveAttribute('aria-pressed', 'true')
  await app.close()
  ;({ app, page } = await launch(workspace))
  await expect(sideBySide()).toHaveAttribute('aria-pressed', 'true')
})

test('can be chosen from the menu', async () => {
  await twoSessions()
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('toggle-layout')?.click())
  await expect(tiles()).toHaveCount(2)
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('toggle-layout')?.click())
  await expect(tiles()).toHaveCount(1)
})

test('marks a tile that stops working, without a notice of what is in plain view', async () => {
  await twoSessions()
  await sideBySide().click()
  await tiles().nth(0).locator('.tile-body').click()
  await page.keyboard.type('sleep 1; for i in 1 2 3 4 5 6 7 8 9 10; do echo tick $i; sleep 0.2; done')
  await page.keyboard.press('Enter')
  await tiles().nth(1).locator('.tile-body').click()

  await expect(tiles().nth(0).locator('.tile-badge')).toBeVisible({ timeout: 15_000 })
  const notices = await app.evaluate(() => ((globalThis as Record<string, unknown>).telegraphNotices as unknown[]).length)
  expect(notices).toBe(0)

  await tiles().nth(0).locator('.tile-body').click()
  await expect(tiles().nth(0).locator('.tile-badge')).toHaveCount(0)
})
