import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { createWorkspace, launch, removeWorkspace, type Workspace } from './telegraph'

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

async function type(text: string): Promise<void> {
  await page.locator('.terminal-view.is-active .xterm-helper-textarea').focus()
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
}

test('shows the saved project and offers to start a session', async () => {
  await expect(page.getByRole('heading', { name: 'No session open in signal-box' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start Shell' })).toBeVisible()
})

test('runs commands in a shell that starts in the project folder', async () => {
  await page.getByRole('button', { name: 'Start Shell' }).click()
  await type('echo "folder: $(basename "$PWD")"')
  await expect(terminal()).toContainText('folder: signal-box')
})

test('describes itself to programs and hides how it was started', async () => {
  await page.getByRole('button', { name: 'Start Shell' }).click()
  await type('echo "program: $TERM_PROGRAM, e2e: ${TELEGRAPH_E2E:-unset}"')
  await expect(terminal()).toContainText('program: Telegraph, e2e: unset')
})

test('runs a launcher command and leaves a shell behind', async () => {
  await page.getByRole('button', { name: 'Start Greeter' }).click()
  await expect(terminal()).toContainText('launched in signal-box')
  await type('echo "still $((40 + 2))"')
  await expect(terminal()).toContainText('still 42')
})

test('keeps sessions apart and switches between them', async () => {
  await page.getByRole('button', { name: 'Start Shell' }).click()
  await type('echo "first $((1 + 1))"')
  await expect(terminal()).toContainText('first 2')

  await page.getByRole('button', { name: 'Start a session in signal-box' }).click()
  await page.getByRole('menuitem', { name: 'Start Shell' }).click()
  await type('echo "second $((2 + 2))"')
  await expect(terminal()).toContainText('second 4')
  await expect(terminal()).not.toContainText('first 2')

  const rows = page.locator('.session')
  await expect(rows).toHaveCount(2)
  await rows.first().locator('.session-main').click()
  await expect(terminal()).toContainText('first 2')
  await expect(terminal()).not.toContainText('second 4')
})

test('marks a session as ended when its shell exits', async () => {
  await page.getByRole('button', { name: 'Start Shell' }).click()
  await type('exit')
  await expect(page.locator('.session')).toHaveAttribute('data-status', 'exited')
  await expect(terminal()).toContainText('Session ended.')
})

test('ends a session and returns to the project', async () => {
  await page.getByRole('button', { name: 'Start Shell' }).click()
  await expect(page.locator('.session')).toHaveCount(1)
  await page.getByRole('button', { name: /^End / }).click()
  await expect(page.locator('.session')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'No session open in signal-box' })).toBeVisible()
})

test('shows a session as working while it keeps printing', async () => {
  await page.getByRole('button', { name: 'Start Shell' }).click()
  await type('for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do echo tick $i; sleep 0.2; done')
  await expect(page.locator('.session')).toHaveAttribute('data-status', 'working')
  await expect(page.locator('.session')).toHaveAttribute('data-status', 'idle', { timeout: 15_000 })
})
