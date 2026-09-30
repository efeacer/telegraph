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

function terminal(): ReturnType<Page['locator']> {
  return page.locator('.terminal-view.is-active .xterm-rows')
}

function row(): ReturnType<Page['locator']> {
  return page.locator('.session').first()
}

function header(): ReturnType<Page['locator']> {
  return page.locator('.stage-header')
}

async function counting(): Promise<void> {
  await start(page, 'Shell')
  await page.locator('.terminal-view.is-active .xterm-helper-textarea').focus()
  await expect(terminal()).toContainText('$')
  // One program that runs until it is stopped, as an agent does. A loop of the shell's would start a
  // program for every step, and a Ctrl-C between two of them would reach none.
  await page.keyboard.type(`perl -e '$| = 1; for (1..400) { print "count $_\\n"; select(undef, undef, undef, 0.1) }'`)
  await page.keyboard.press('Enter')
  await expect(terminal()).toContainText('count 3')
}

async function lastCount(): Promise<number> {
  const numbers = [...(await terminal().innerText()).matchAll(/count (\d+)/g)].map((found) => Number(found[1]))
  return Math.max(...numbers)
}

test('pauses a session where it is, and plays it on from there', async () => {
  await counting()
  await header().getByRole('button', { name: 'Pause' }).click()
  await expect(row()).toHaveAttribute('data-paused', 'true')
  await expect(row().locator('.session-status')).toContainText('Paused')

  await page.waitForTimeout(400)
  const paused = await lastCount()
  await page.waitForTimeout(1200)
  expect(await lastCount()).toBe(paused)

  await header().getByRole('button', { name: 'Resume' }).click()
  await expect(row()).not.toHaveAttribute('data-paused', 'true')
  await expect.poll(lastCount).toBeGreaterThan(paused + 3)
})

/** Stop is in the menu, as ⌘.: the × beside a session ends it. */
function stop(): Promise<void> {
  return app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('stop-session')?.click())
}

test('stops what a session is doing, and keeps the session', async () => {
  await counting()
  await stop()
  await page.waitForTimeout(600)
  const stopped = await lastCount()
  await page.waitForTimeout(1200)
  expect(await lastCount()).toBe(stopped)

  await page.locator('.terminal-view.is-active .xterm-helper-textarea').focus()
  await page.keyboard.type('echo "still here $((40 + 2))"')
  await page.keyboard.press('Enter')
  await expect(terminal()).toContainText('still here 42')
  await expect(page.locator('.session')).toHaveCount(1)
})

test('stops a paused session too', async () => {
  await counting()
  await header().getByRole('button', { name: 'Pause' }).click()
  await expect(row()).toHaveAttribute('data-paused', 'true')
  await stop()
  await expect(row()).not.toHaveAttribute('data-paused', 'true')
  await page.locator('.terminal-view.is-active .xterm-helper-textarea').focus()
  await page.keyboard.type('echo "after $((40 + 2))"')
  await page.keyboard.press('Enter')
  await expect(terminal()).toContainText('after 42')
})

test('does not tell of a session that was paused as if it waited', async () => {
  await counting()
  await row().getByRole('button', { name: /^Pause / }).click()
  await page.getByRole('button', { name: 'Start a session in signal-box' }).click()
  await page.getByRole('menuitem', { name: 'Start Shell' }).click()
  await page.waitForTimeout(3500)
  await expect(row().locator('.session-badge')).toHaveCount(0)
  const notices = await app.evaluate(() => ((globalThis as Record<string, unknown>).telegraphNotices as unknown[]).length)
  expect(notices).toBe(0)
})

test('has the controls in the row, in the tile, and in the menu', async () => {
  await counting()
  await row().getByRole('button', { name: /^Pause / }).click()
  await expect(row()).toHaveAttribute('data-paused', 'true')
  await row().getByRole('button', { name: /^Resume / }).click()
  await expect(row()).not.toHaveAttribute('data-paused', 'true')

  await page.getByRole('button', { name: 'Show sessions side by side' }).click()
  await page.locator('.tile').getByRole('button', { name: /^Pause / }).click()
  await expect(row()).toHaveAttribute('data-paused', 'true')

  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('pause-session')?.click())
  await expect(row()).not.toHaveAttribute('data-paused', 'true')
})

test('explains each control when pointed at', async () => {
  await counting()
  await expect(header().getByRole('button', { name: 'Pause' })).toHaveAttribute('title', /Freeze .* where it is/)
  // Only pause and the ×: a square stop beside the × said the same twice.
  await expect(page.getByRole('button', { name: /^Stop/ })).toHaveCount(0)
})

test.describe('the first start', () => {
  test('welcomes someone new, and says what to do first', async () => {
    await app.close()
    const { writeFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    // A shell and no agent: nothing real is started as the companion under test.
    writeFileSync(join(workspace.userData, 'state.json'), JSON.stringify({ projects: [], launchers: [{ id: 'shell', name: 'Shell', command: null }] }))
    ;({ app, page } = await launch(workspace))

    await expect(page.getByRole('heading', { name: 'Welcome to Telegraph' })).toBeVisible()
    const steps = page.getByRole('list', { name: 'Getting started' }).getByRole('listitem')
    await expect(steps).toHaveCount(3)
    await expect(steps.nth(0)).toContainText('Add a project')
    await expect(steps.nth(1)).toContainText('Start an agent')
    await expect(steps.nth(2)).toContainText('Connect Google')

    await steps.nth(2).getByRole('button', { name: 'Connect Google' }).click()
    await expect(page.getByRole('dialog', { name: 'Connections' })).toBeVisible()
  })
})
