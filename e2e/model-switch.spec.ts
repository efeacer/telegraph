import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { choose, createWorkspace, launch, removeWorkspace, start, type Workspace } from './telegraph'

let workspace: Workspace
let app: ElectronApplication
let page: Page

/** Stands in for an agent: a shell, which says back the command it is sent to change model. */
const SWITCHER = {
  id: 'switcher',
  name: 'Switcher',
  command: 'echo started with',
  modelFlag: '--model',
  modelCommand: 'echo now on',
  providers: ['aviary'],
  models: [{ id: 'swift', name: 'Swift, latest' }]
}

function addLauncher(launcher: Record<string, unknown>): void {
  const path = join(workspace.userData, 'state.json')
  const state = JSON.parse(readFileSync(path, 'utf8'))
  state.launchers.push(launcher)
  writeFileSync(path, JSON.stringify(state))
}

test.beforeEach(async () => {
  workspace = createWorkspace()
  addLauncher(SWITCHER)
  ;({ app, page } = await launch(workspace))
})

test.afterEach(async () => {
  await app.close()
  removeWorkspace(workspace)
})

function terminal(): ReturnType<Page['locator']> {
  return page.locator('.terminal-view.is-active .xterm-rows')
}

function switcher(): ReturnType<Page['locator']> {
  return page.getByRole('combobox', { name: 'Model of this session' })
}

async function startOn(model: string): Promise<void> {
  await choose(page, 'Agent', 'Switcher')
  await choose(page, 'Model', model)
  await page.getByRole('button', { name: 'Start Switcher' }).click()
  await expect(terminal()).toContainText('started with')
  await expect(terminal()).toContainText('$')
}

test('shows the model of a session in its row', async () => {
  await startOn('Swift 5')
  await expect(page.locator('.session').first().locator('.session-model')).toHaveText('Swift 5')
  await expect(switcher()).toHaveText('Swift 5')
})

test('says nothing of a model where none was chosen or reported', async () => {
  await start(page, 'Shell')
  await expect(page.locator('.session-model')).toHaveCount(0)
  await expect(switcher()).toHaveCount(0)
})

test('switches the model of a running session', async () => {
  await startOn('Swift 5')
  await switcher().click()
  await expect(page.getByRole('option')).toHaveText([/^Swift, latest/, /^Swift 5/, /^Swift 4/])
  await page.getByRole('option', { name: 'Swift 4' }).click()

  await expect(terminal()).toContainText('now on swift-4')
  await expect(page.locator('.session-model')).toHaveText('Swift 4')
  await expect(switcher()).toHaveText('Swift 4')
})

test('remembers the model it was switched to for the next session', async () => {
  await startOn('Swift 5')
  await choose(page, 'Model of this session', 'Swift 4')
  await expect(terminal()).toContainText('now on swift-4')
  await expect
    .poll(() => JSON.parse(readFileSync(join(workspace.userData, 'state.json'), 'utf8')).choices)
    .toEqual({ 'project-1': { launcherId: 'switcher', models: { switcher: 'swift-4' } } })
})

test('does not switch while something has been typed and not sent', async () => {
  await startOn('Swift 5')
  await page.locator('.terminal-view.is-active .xterm-helper-textarea').focus()
  await page.keyboard.type('half a thought')
  await choose(page, 'Model of this session', 'Swift 4')

  await expect(page.getByRole('alert')).toContainText('Send or clear what you have typed')
  await expect(terminal()).not.toContainText('now on')
  await expect(page.locator('.session-model')).toHaveText('Swift 5')
})

test('does not switch while the agent works', async () => {
  await startOn('Swift 5')
  await page.locator('.terminal-view.is-active .xterm-helper-textarea').focus()
  await page.keyboard.type('for i in 1 2 3 4 5 6 7 8 9 10 11 12; do echo tick $i; sleep 0.2; done')
  await page.keyboard.press('Enter')
  await expect(page.locator('.session')).toHaveAttribute('data-status', 'working')
  await choose(page, 'Model of this session', 'Swift 4')

  await expect(page.getByRole('alert')).toContainText('is working')
  await expect(terminal()).not.toContainText('now on')
})

test('shows the model a session reports, which is what it really runs', async () => {
  await app.close()
  const report = JSON.stringify({ model: { display_name: 'Opus 5.5' } })
  addLauncher({
    id: 'reporter',
    name: 'Reporter',
    command: `printf '%s' '${report}' > "$TELEGRAPH_USAGE_FILE" && echo reported`
  })
  ;({ app, page } = await launch(workspace))
  await start(page, 'Reporter')
  await expect(terminal()).toContainText('reported')
  await expect(page.locator('.session-model')).toHaveText('Opus 5.5')
})

test('shows the model in the head of a tile', async () => {
  await startOn('Swift 5')
  await page.getByRole('button', { name: 'Show sessions side by side' }).click()
  await expect(page.locator('.tile .tile-model')).toHaveText('Swift 5')
})
