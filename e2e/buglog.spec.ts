import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { LogEntry } from '../src/shared/buglog'
import { createWorkspace, launch, removeWorkspace, type Workspace } from './telegraph'

let workspace: Workspace
let app: ElectronApplication
let page: Page

test.beforeEach(async () => {
  workspace = createWorkspace()
  ;({ app, page } = await launch(workspace))
  await expect(page.getByRole('button', { name: 'Start Shell' })).toBeVisible()
})

test.afterEach(async () => {
  await app.close().catch(() => {})
  removeWorkspace(workspace)
})

function logged(): LogEntry[] {
  const path = join(workspace.userData, 'logs', 'bugs.jsonl')
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as LogEntry)
}

async function entryOfKind(kind: LogEntry['kind']): Promise<LogEntry> {
  await expect.poll(() => logged().map((entry) => entry.kind)).toContain(kind)
  return logged().find((entry) => entry.kind === kind)!
}

async function chooseFromMenu(id: string): Promise<void> {
  await app.evaluate(({ Menu }, itemId) => {
    Menu.getApplicationMenu()?.getMenuItemById(itemId)?.click()
  }, id)
}

test('records nothing while all is well', async () => {
  await page.getByRole('button', { name: 'Start Shell' }).click()
  await expect(page.locator('.session')).toHaveCount(1)
  await app.close()
  expect(logged()).toEqual([])
  expect(existsSync(join(workspace.userData, 'logs', 'running.json'))).toBe(false)
})

test('records an error thrown in the window', async () => {
  await page.evaluate(() => {
    setTimeout(() => {
      throw new TypeError('thrown for the test')
    })
  })

  const entry = await entryOfKind('window-error')
  expect(entry.message).toBe('TypeError: thrown for the test')
  expect(entry.stack).toContain('thrown for the test')
  expect(entry.build.version).toBe('0.1.0')
  expect(Date.parse(entry.build.builtAt)).not.toBeNaN()
  expect(logged()).toHaveLength(1)
})

test('records a promise rejected in the window', async () => {
  await page.evaluate(() => {
    void Promise.reject(new Error('rejected for the test'))
  })

  const entry = await entryOfKind('window-rejection')
  expect(entry.message).toBe('Error: rejected for the test')
  expect(logged()).toHaveLength(1)
})

test('records an error the window logs to its console', async () => {
  await page.evaluate(() => console.error('logged for the test'))

  const entry = await entryOfKind('console-error')
  expect(entry.message).toBe('logged for the test')
})

test('records an error thrown in the main process', async () => {
  await app.evaluate(() => {
    setTimeout(() => {
      throw new Error('thrown in the main process')
    })
  })

  const entry = await entryOfKind('main-error')
  expect(entry.message).toBe('Error: thrown in the main process')
  await expect(page.getByRole('alert')).toContainText('Telegraph ran into a problem')
  // The app carries on, because ending it would end every session in it.
  await page.getByRole('button', { name: 'Start Shell' }).click()
  await expect(page.locator('.session')).toHaveCount(1)
})

test('records a session that could not start', async () => {
  rmSync(workspace.projectPath, { recursive: true })
  await page.getByRole('button', { name: 'Start Shell' }).click()
  await expect(page.getByRole('alert')).toContainText('Could not start Shell in signal-box')

  const entry = await entryOfKind('session-failure')
  expect(entry.message).toContain('does not exist')
})

test('records a window that crashed', async () => {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.forcefullyCrashRenderer()
  })

  const entry = await entryOfKind('window-crash')
  expect(entry.message).toBe("The window's process ended: killed")
  expect(entry.detail).toMatchObject({ reason: 'killed' })
})

test('records a run that was killed', async () => {
  app.process().kill('SIGKILL')
  await app.waitForEvent('close')

  ;({ app, page } = await launch(workspace))
  await expect(page.getByRole('button', { name: 'Start Shell' })).toBeVisible()

  const entry = await entryOfKind('unclean-exit')
  expect(entry.message).toBe('The previous run ended without shutting down')
  expect(entry.build.version).toBe('0.1.0')
  expect(entry.detail).toMatchObject({ run: expect.any(String), startedAt: expect.any(String) })
})

test('keeps what is in the terminals out of the log', async () => {
  await page.getByRole('button', { name: 'Start Shell' }).click()
  await page.locator('.terminal-view.is-active .xterm-helper-textarea').focus()
  await page.keyboard.type('printf "\\033]0;secret-title\\007"; echo "secret-$((40 + 2))-output"')
  await page.keyboard.press('Enter')
  await expect(page.locator('.terminal-view.is-active .xterm-rows')).toContainText('secret-42-output')
  await expect(page.locator('.session-title')).toHaveText('secret-title')

  await page.evaluate(() => console.error('could not draw "secret-glyph"'))
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('thrown beside a session')
    })
  })
  await chooseFromMenu('report-bug')
  const dialog = page.getByRole('dialog', { name: 'Report a bug' })
  await dialog.getByLabel('What went wrong?').fill('A note made beside a session')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await entryOfKind('bug-report')
  await entryOfKind('window-error')
  await entryOfKind('console-error')

  expect(JSON.stringify(logged())).not.toContain('secret')
})

test('saves a note about a bug', async () => {
  await page.getByRole('button', { name: 'Start Shell' }).click()
  await expect(page.locator('.session')).toHaveCount(1)

  await chooseFromMenu('report-bug')
  const dialog = page.getByRole('dialog', { name: 'Report a bug' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled()

  await dialog.getByLabel('What went wrong?').fill('The wire flickers when a session ends')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()

  const entry = await entryOfKind('bug-report')
  expect(entry.message).toBe('The wire flickers when a session ends')
  expect(entry.detail).toEqual({
    projects: 1,
    sessions: [{ launcher: 'Shell', status: expect.any(String), active: true }]
  })
  await expect(page.locator('.terminal-view.is-active .xterm-helper-textarea')).toBeFocused()
})

test('saves nothing when the note is abandoned', async () => {
  await chooseFromMenu('report-bug')
  const dialog = page.getByRole('dialog', { name: 'Report a bug' })
  await dialog.getByLabel('What went wrong?').fill('Never mind')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()

  await chooseFromMenu('report-bug')
  await expect(dialog.getByLabel('What went wrong?')).toHaveValue('')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  expect(logged()).toEqual([])
})
