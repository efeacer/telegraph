import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { choose, createWorkspace, launch, removeWorkspace, start, type Workspace } from './telegraph'

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

function blank(name: string): ReturnType<Page['locator']> {
  return page.getByRole('combobox', { name })
}

function terminal(): ReturnType<Page['locator']> {
  return page.locator('.terminal-view.is-active .xterm-rows')
}

function savedState(): { choices?: unknown; launchers?: unknown } {
  return JSON.parse(readFileSync(join(workspace.userData, 'state.json'), 'utf8'))
}

test('offers the programs it finds and leaves out the one it does not', async () => {
  await blank('Agent').click()
  await expect(page.getByRole('option')).toHaveText(['Shell', 'Greeter', 'Parrot'])
})

test('starts an agent on its usual model', async () => {
  await choose(page, 'Agent', 'Parrot')
  await expect(blank('Model')).toHaveText('its usual model')
  await page.getByRole('button', { name: 'Start Parrot' }).click()

  await expect(terminal()).toContainText('started with')
  await expect(terminal()).not.toContainText('--model')
})

test('starts an agent on the model that was chosen', async () => {
  await choose(page, 'Agent', 'Parrot')
  await blank('Model').click()
  await expect(page.getByRole('option')).toHaveText([
    /^its usual model/,
    /^Swift, latest/,
    /^Swift 5/,
    /^Swift 4/,
    /^another model/
  ])
  await page.getByRole('option', { name: /^Swift 5/ }).click()
  await page.getByRole('button', { name: 'Start Parrot' }).click()

  await expect(terminal()).toContainText('started with --model swift-5')
  await expect(page.locator('.stage-model')).toHaveText('Swift 5')
})

test('starts an agent on a model that was typed in', async () => {
  await choose(page, 'Agent', 'Parrot')
  await choose(page, 'Model', 'another model…')
  await page.getByRole('textbox', { name: 'Model' }).fill('owl-2; echo gotcha')
  await page.keyboard.press('Enter')

  await expect(terminal()).toContainText('started with --model owl-2; echo gotcha')
  await expect(terminal()).not.toContainText(/^gotcha/m)
})

test('goes back to the list when typing a model is given up', async () => {
  await choose(page, 'Agent', 'Parrot')
  await choose(page, 'Model', 'another model…')
  await page.getByRole('textbox', { name: 'Model' }).fill('owl')
  await page.keyboard.press('Escape')

  await expect(blank('Model')).toHaveText('its usual model')
  await expect(blank('Model')).toBeFocused()
})

test('continues the last chat', async () => {
  await choose(page, 'Agent', 'Parrot')
  await choose(page, 'Model', 'Swift, latest')
  await choose(page, 'Chat', 'continue last chat')
  await page.getByRole('button', { name: 'Start Parrot' }).click()

  await expect(terminal()).toContainText('started with --model swift --continue')
})

test('asks for no model where there is none to choose', async () => {
  await choose(page, 'Agent', 'Shell')
  await expect(blank('Model')).toHaveCount(0)
  await expect(blank('Chat')).toHaveCount(0)

  await choose(page, 'Agent', 'Greeter')
  await expect(blank('Model')).toHaveCount(0)
})

test('can be filled in from the keyboard', async () => {
  await blank('Agent').focus()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('listbox', { name: 'Agent' })).toBeVisible()
  await expect(page.getByRole('option', { name: 'Greeter' })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(blank('Agent')).toHaveText('Parrot')
  await expect(page.getByRole('listbox')).toHaveCount(0)

  await page.keyboard.press('Enter')
  await page.keyboard.type('sh')
  await page.keyboard.press('Enter')
  await expect(blank('Agent')).toHaveText('Shell')

  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await expect(blank('Agent')).toBeFocused()
})

test('remembers what was chosen in the project', async () => {
  await choose(page, 'Agent', 'Parrot')
  await choose(page, 'Model', 'Swift 4')
  await choose(page, 'Chat', 'continue last chat')
  await page.getByRole('button', { name: 'Start Parrot' }).click()
  await expect(terminal()).toContainText('started with --model swift-4 --continue')

  await page.getByRole('button', { name: /^End / }).click()
  await expect(blank('Agent')).toHaveText('Parrot')
  await expect(blank('Model')).toHaveText('Swift 4')
  // Continuing a chat is a choice made each time.
  await expect(blank('Chat')).toHaveText('new chat')
  expect(savedState().choices).toEqual({
    'project-1': { launcherId: 'parrot', models: { parrot: 'swift-4' } }
  })

  await app.close()
  ;({ app, page } = await launch(workspace))
  await expect(blank('Agent')).toHaveText('Parrot')
  await expect(blank('Model')).toHaveText('Swift 4')
})

test('starts from the sidebar with the model that was chosen last', async () => {
  await choose(page, 'Agent', 'Parrot')
  await choose(page, 'Model', 'Swift 5')
  await page.getByRole('button', { name: 'Start Parrot' }).click()
  await expect(terminal()).toContainText('started with --model swift-5')

  await page.getByRole('button', { name: 'Start a session in signal-box' }).click()
  await expect(page.getByRole('menuitem')).toHaveText([
    'Start Shell',
    'Start Greeter',
    'Start Parrot',
    'Parrot, continue last chat',
    'Choose a model…',
    'Remove project'
  ])
  await page.getByRole('menuitem', { name: 'Parrot, continue last chat' }).click()
  await expect(page.locator('.session')).toHaveCount(2)
  await expect(terminal()).toContainText('started with --model swift-5 --continue')
})

test('shows the choice again while sessions are open', async () => {
  await start(page, 'Shell')
  await expect(page.locator('.session')).toHaveCount(1)

  await page.getByRole('button', { name: 'Start a session in signal-box' }).click()
  await page.getByRole('menuitem', { name: 'Choose a model…' }).click()
  await expect(page.getByRole('heading', { name: 'Start a session in signal-box' })).toBeVisible()
  await expect(blank('Agent')).toHaveText('Shell')
})

test('keeps the launchers the user wrote in the file', async () => {
  await start(page, 'Shell')
  await expect(page.locator('.session')).toHaveCount(1)
  expect(savedState().launchers).toHaveLength(4)
})
