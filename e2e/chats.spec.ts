import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { choose, createWorkspace, launch, recordChat, removeWorkspace, type Workspace } from './telegraph'

const SEATS = '11111111-1111-4111-8111-111111111111'
const LOGGING = '22222222-2222-4222-8222-222222222222'
const ELSEWHERE = '33333333-3333-4333-8333-333333333333'

let workspace: Workspace
let app: ElectronApplication
let page: Page

test.beforeEach(async () => {
  workspace = createWorkspace()
  recordChat(workspace, { id: SEATS, title: 'Fix the seat picker', minutesAgo: 3 * 60 })
  recordChat(workspace, { id: LOGGING, title: 'Add bug logging', minutesAgo: 5 })
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

test('offers the chats that were had in the project, the latest first', async () => {
  await choose(page, 'Agent', 'Parrot')
  await blank('Chat').click()

  await expect(page.getByRole('option')).toHaveText([
    'start a new chat',
    'continue last chat',
    /^reopen “Add bug logging”\s*5 minutes ago$/,
    /^reopen “Fix the seat picker”\s*3 hours ago$/
  ])
})

test('opens a chat again, under the project it was had in', async () => {
  await choose(page, 'Agent', 'Parrot')
  await choose(page, 'Chat', 'reopen “Fix the seat picker”')
  await expect(blank('Chat')).toHaveText('reopen “Fix the seat picker”')
  await page.getByRole('button', { name: 'Start Parrot' }).click()

  await expect(terminal()).toContainText(`started with --resume ${SEATS}`)
  await expect(page.locator('.project.is-selected .session')).toHaveCount(1)
  await expect(page.locator('.project.is-selected .project-title')).toHaveText('signal-box')
})

test('opens a chat again on the model that was chosen', async () => {
  await choose(page, 'Agent', 'Parrot')
  await choose(page, 'Model', 'Swift 5')
  await choose(page, 'Chat', 'reopen “Add bug logging”')
  await page.getByRole('button', { name: 'Start Parrot' }).click()

  await expect(terminal()).toContainText(`started with --model swift-5 --resume ${LOGGING}`)
})

test('finds a chat by typing what it is called', async () => {
  await choose(page, 'Agent', 'Parrot')
  await blank('Chat').focus()
  await page.keyboard.press('Enter')
  await page.keyboard.type('fix the')
  await page.keyboard.press('Enter')
  await expect(blank('Chat')).toHaveText('reopen “Fix the seat picker”')
})

test('offers no chats for an agent that keeps none', async () => {
  await choose(page, 'Agent', 'Greeter')
  await expect(blank('Chat')).toHaveCount(0)
})

test('starts a new chat unless another is chosen', async () => {
  await choose(page, 'Agent', 'Parrot')
  await expect(blank('Chat')).toHaveText('start a new chat')
  await page.getByRole('button', { name: 'Start Parrot' }).click()

  await expect(terminal()).toContainText('started with')
  await expect(terminal()).not.toContainText('--resume')
})

test('offers the chats of the project that is selected', async () => {
  await app.close()
  const depot = join(workspace.root, 'depot')
  mkdirSync(depot)
  const statePath = join(workspace.userData, 'state.json')
  const state = JSON.parse(readFileSync(statePath, 'utf8'))
  state.projects.push({ id: 'project-2', name: 'depot', path: depot })
  writeFileSync(statePath, JSON.stringify(state))
  recordChat(workspace, { id: ELSEWHERE, title: 'Count the wagons', minutesAgo: 60, folder: depot })
  ;({ app, page } = await launch(workspace))

  await page.getByRole('button', { name: 'depot', exact: true }).click()
  await choose(page, 'Agent', 'Parrot')
  await blank('Chat').click()
  await expect(page.getByRole('option')).toHaveText([
    'start a new chat',
    'continue last chat',
    /^reopen “Count the wagons”/
  ])
  await page.getByRole('option', { name: 'reopen “Count the wagons”' }).click()
  await page.getByRole('button', { name: 'Start Parrot' }).click()

  await expect(terminal()).toContainText(`started with --resume ${ELSEWHERE}`)
  await expect(page.locator('.project.is-selected .project-title')).toHaveText('depot')
  await expect(page.locator('.project.is-selected .session')).toHaveCount(1)
})
