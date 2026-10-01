import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { createWorkspace, launch, removeWorkspace, start, type Workspace } from './telegraph'

let workspace: Workspace
let app: ElectronApplication
let page: Page

/** Stands in for an agent: a shell, which says back the command it is sent to rename the chat. */
const NAMER = { id: 'namer', name: 'Namer', command: 'echo started', renameCommand: 'echo renamed to' }

test.beforeEach(async () => {
  workspace = createWorkspace()
  const path = join(workspace.userData, 'state.json')
  const state = JSON.parse(readFileSync(path, 'utf8'))
  state.launchers.push(NAMER)
  writeFileSync(path, JSON.stringify(state))
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

async function startNamer(): Promise<void> {
  await start(page, 'Namer')
  await expect(terminal()).toContainText('started')
  await expect(terminal()).toContainText('$')
}

async function rename(name: string, key: 'Enter' | 'Escape' = 'Enter'): Promise<void> {
  await row().locator('.session-title').dblclick()
  const field = page.getByRole('textbox', { name: 'Name of the session' })
  await expect(field).toBeFocused()
  await field.fill(name)
  await page.keyboard.press(key)
}

test('renames a session where it is listed', async () => {
  await startNamer()
  await rename('Fix the seat picker')

  await expect(row().locator('.session-title')).toHaveText('Fix the seat picker')
  await expect(page.locator('.stage-session')).toHaveText('Fix the seat picker')
  await page.getByRole('button', { name: 'Show sessions side by side' }).click()
  await expect(page.locator('.tile-title')).toHaveText('Fix the seat picker')
})

test('tells the agent the new name, so that its record of the chat keeps it', async () => {
  await startNamer()
  await rename('Fix the seat picker')
  await expect(terminal()).toContainText('renamed to Fix the seat picker')
  await expect(page.locator('.terminal-view.is-active .xterm-helper-textarea')).toBeFocused()
})

test('keeps the name over the one the program gives itself', async () => {
  await start(page, 'Shell')
  await expect(terminal()).toContainText('$')
  await rename('Build')
  await page.locator('.terminal-view.is-active .xterm-helper-textarea').focus()
  await page.keyboard.type(`printf '\\033]0;set by the program\\007'`)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(300)
  await expect(row().locator('.session-title')).toHaveText('Build')
})

test('goes back to the name of the program when the name is cleared', async () => {
  await start(page, 'Shell')
  await expect(terminal()).toContainText('$')
  await rename('Build')
  await rename('')
  await expect(row().locator('.session-title')).toHaveText('Shell')
})

test('leaves the name as it was when renaming is given up', async () => {
  await startNamer()
  await rename('Not this', 'Escape')
  await expect(row().locator('.session-title')).toHaveText('Namer')
  await expect(terminal()).not.toContainText('renamed to')
})

test('waits until the agent is done before telling it the new name', async () => {
  await startNamer()
  await page.locator('.terminal-view.is-active .xterm-helper-textarea').focus()
  await page.keyboard.type('for i in 1 2 3 4 5 6 7 8 9 10 11 12; do echo tick $i; sleep 0.2; done')
  await page.keyboard.press('Enter')
  await expect(row()).toHaveAttribute('data-status', 'working')
  await rename('Long job')

  await expect(row().locator('.session-title')).toHaveText('Long job')
  await expect(terminal()).toContainText('tick 12', { timeout: 15_000 })
  await expect(terminal()).toContainText('renamed to Long job', { timeout: 10_000 })
  const text = await terminal().innerText()
  expect(text.indexOf('renamed to Long job')).toBeGreaterThan(text.indexOf('tick 12'))
})

test('waits until what was typed is sent before telling the agent', async () => {
  await startNamer()
  await page.locator('.terminal-view.is-active .xterm-helper-textarea').focus()
  await page.keyboard.type('echo half')
  await rename('Drafting')
  await page.waitForTimeout(500)
  await expect(terminal()).not.toContainText('renamed to')

  await page.locator('.terminal-view.is-active .xterm-helper-textarea').focus()
  await page.keyboard.press('Enter')
  await expect(terminal()).toContainText('renamed to Drafting', { timeout: 10_000 })
})

test('renames from the menu, and in the tile', async () => {
  await startNamer()
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('rename-session')?.click())
  const field = page.getByRole('textbox', { name: 'Name of the session' })
  await expect(field).toBeFocused()
  await field.fill('From the menu')
  await page.keyboard.press('Enter')
  await expect(row().locator('.session-title')).toHaveText('From the menu')

  await page.getByRole('button', { name: 'Show sessions side by side' }).click()
  await page.locator('.tile-title').dblclick()
  await page.getByRole('textbox', { name: 'Name of the session' }).fill('From the tile')
  await page.keyboard.press('Enter')
  await expect(row().locator('.session-title')).toHaveText('From the tile')
})

test('renames from the sidebar while the sessions are side by side', async () => {
  await startNamer()
  await page.getByRole('button', { name: 'Show sessions side by side' }).click()
  await rename('From the sidebar')
  await expect(page.getByRole('textbox', { name: 'Name of the session' })).toHaveCount(0)
  await expect(page.locator('.tile-title')).toHaveText('From the sidebar')
  await expect(terminal()).toContainText('renamed to From the sidebar')
})

test('takes a name typed with spaces, key by key, in the sidebar and in a tile', async () => {
  await startNamer()
  await row().locator('.session-title').dblclick()
  const field = page.getByRole('textbox', { name: 'Name of the session' })
  await expect(field).toBeFocused()
  await page.keyboard.press('Meta+a')
  await page.keyboard.type('Fix the seat picker')
  await expect(field).toBeFocused()
  await expect(field).toHaveValue('Fix the seat picker')
  await page.keyboard.press('Enter')
  await expect(row().locator('.session-title')).toHaveText('Fix the seat picker')

  await page.getByRole('button', { name: 'Show sessions side by side' }).click()
  await page.locator('.tile-title').dblclick()
  await page.keyboard.press('Meta+a')
  await page.keyboard.type('A name with spaces')
  await page.keyboard.press('Enter')
  await expect(row().locator('.session-title')).toHaveText('A name with spaces')
})
