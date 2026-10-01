import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { choose, configDirOf, createWorkspace, launch, removeWorkspace, start, type Workspace } from './telegraph'

let workspace: Workspace
let app: ElectronApplication
let first: Page

test.beforeEach(() => {
  workspace = createWorkspace()
})

test.afterEach(async () => {
  await app.close()
  removeWorkspace(workspace)
})

async function open(): Promise<void> {
  ;({ app, page: first } = await launch(workspace))
}

/** Opens another window, as File > New Window does. */
async function newWindow(): Promise<Page> {
  const opened = app.waitForEvent('window')
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('new-window')?.click())
  const page = await opened
  await page.waitForLoadState('domcontentloaded')
  return page
}

function terminal(page: Page): ReturnType<Page['locator']> {
  return page.locator('.terminal-view.is-active .xterm-rows')
}

async function say(page: Page, text: string): Promise<void> {
  await page.locator('.terminal-view.is-active .xterm-helper-textarea').focus()
  await expect(terminal(page)).toContainText('$')
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
}

test('opens another window, with sessions of its own', async () => {
  await open()
  await start(first, 'Shell')
  await say(first, 'echo "first $((1 + 1))"')
  await expect(terminal(first)).toContainText('first 2')

  const second = await newWindow()
  await expect(second.getByRole('heading', { name: 'No session open in signal-box' })).toBeVisible()
  await start(second, 'Shell')
  await say(second, 'echo "second $((2 + 2))"')
  await expect(terminal(second)).toContainText('second 4')

  await expect(terminal(first)).not.toContainText('second 4')
  await expect(first.locator('.session')).toHaveCount(1)
  await expect(second.locator('.session')).toHaveCount(1)
})

test('keeps the sessions of one window when another is closed or reloaded', async () => {
  await open()
  await start(first, 'Shell')
  const second = await newWindow()
  await start(second, 'Shell')
  await expect(second.locator('.session')).toHaveCount(1)

  await second.reload()
  await expect(second.getByRole('heading', { name: 'No session open in signal-box' })).toBeVisible()
  await say(first, 'echo "still $((40 + 2))"')
  await expect(terminal(first)).toContainText('still 42')

  await second.close()
  await say(first, 'echo "and still $((40 + 3))"')
  await expect(terminal(first)).toContainText('and still 43')
})

test('opens a window when Telegraph is started again', async () => {
  await open()
  const opened = app.waitForEvent('window')
  const binary = await app.evaluate(() => process.execPath)
  // Started again, as from the Dock or a terminal: the running Telegraph opens a window, and the new one ends.
  spawn(binary, [join(__dirname, '..')], {
    env: { ...process.env, TELEGRAPH_E2E: '1', TELEGRAPH_USER_DATA: workspace.userData, CLAUDE_CONFIG_DIR: configDirOf(workspace), SHELL: '/bin/sh' },
    stdio: 'ignore'
  })
  const second = await opened
  await expect(second.getByRole('heading', { name: 'No session open in signal-box' })).toBeVisible()
})

test('shares the projects and the theme between windows', async () => {
  await open()
  const second = await newWindow()
  await choose(second, 'Theme', 'Creme')
  await expect(first.locator('html')).toHaveAttribute('data-theme', 'creme')

  await second.getByRole('button', { name: 'Start a session in signal-box' }).click()
  await second.getByRole('menuitem', { name: 'Remove project' }).click()
  await expect(first.locator('.project-title', { hasText: 'signal-box' })).toHaveCount(0)
})

test('counts on the icon what is new in every window', async () => {
  await open()
  const countOnIcon = () => app.evaluate(() => (globalThis as Record<string, unknown>).telegraphBadge as number)
  const endUnseen = async (page: Page) => {
    await start(page, 'Shell')
    await say(page, 'sleep 1; exit')
    await page.getByRole('button', { name: 'Start a session in signal-box' }).click()
    await page.getByRole('menuitem', { name: 'Start Shell' }).click()
  }
  await endUnseen(first)
  await expect.poll(countOnIcon, { timeout: 10_000 }).toBe(1)
  const second = await newWindow()
  await endUnseen(second)
  await expect.poll(countOnIcon, { timeout: 10_000 }).toBe(2)
})

test('has one companion, in the first window, which another takes over when it is closed', async () => {
  const path = join(workspace.userData, 'state.json')
  const state = JSON.parse(readFileSync(path, 'utf8'))
  state.launchers.push({ id: 'claude', name: 'Claude', command: 'echo companion started' })
  writeFileSync(path, JSON.stringify(state))
  await open()
  await expect(first.locator('.project.is-companion .session')).toHaveCount(1)

  const second = await newWindow()
  await expect(second.getByRole('heading', { name: 'No session open in signal-box' })).toBeVisible()
  await expect(second.locator('.project.is-companion')).toHaveCount(0)

  await first.close()
  await expect(second.locator('.project.is-companion .session')).toHaveCount(1)
})

