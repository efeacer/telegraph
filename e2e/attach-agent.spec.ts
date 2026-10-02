/// <reference lib="dom" />
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { createWorkspace, launch, removeWorkspace, start, type Workspace } from './telegraph'

let workspace: Workspace
let app: ElectronApplication
let page: Page
let plain: string
let spaced: string
let folder: string
let image: string

test.beforeEach(async () => {
  workspace = createWorkspace()
  // In place of an agent that reads what is mentioned: keeps each line it is given.
  const statePath = join(workspace.userData, 'state.json')
  const state = JSON.parse(readFileSync(statePath, 'utf8'))
  state.launchers.push({ id: 'reader', name: 'Reader', command: 'cat > received.txt', attachAs: 'mention' })
  writeFileSync(statePath, JSON.stringify(state))

  plain = join(workspace.root, 'plain.txt')
  spaced = join(workspace.root, 'notes file.txt')
  folder = join(workspace.root, 'my project')
  image = join(workspace.root, 'shot.png')
  writeFileSync(plain, 'plain')
  writeFileSync(spaced, 'notes')
  writeFileSync(image, Buffer.from([137, 80, 78, 71]))
  mkdirSync(folder)

  ;({ app, page } = await launch(workspace, { TELEGRAPH_TEST_ATTACH_PATHS: JSON.stringify([spaced, folder]) }))
  await start(page, 'Reader')
  await page.locator('.terminal-view.is-active .xterm-helper-textarea').focus()
})

test.afterEach(async () => {
  await app.close()
  removeWorkspace(workspace)
})

/** Drops files on the terminal the way the system does, which hands over where they are. */
async function drop(...files: string[]): Promise<void> {
  const box = (await page.locator('.terminal-view.is-active').boundingBox())!
  const cdp = await page.context().newCDPSession(page)
  const at = { x: Math.round(box.x + 120), y: Math.round(box.y + 80) }
  const data = { items: [], files, dragOperationsMask: 1 }
  for (const type of ['dragEnter', 'dragOver', 'drop'] as const) {
    await cdp.send('Input.dispatchDragEvent', { type, ...at, data })
  }
}

/** The line the program was given, once Enter is pressed. */
async function received(): Promise<string> {
  await page.keyboard.press('Enter')
  const path = join(workspace.projectPath, 'received.txt')
  await expect.poll(() => readFileSync(path, 'utf8')).toContain('\n')
  return readFileSync(path, 'utf8')
}

test('mentions dropped files and folders to an agent, in quotes where the name has spaces', async () => {
  await page.keyboard.type('look at')
  await drop(plain, spaced, folder)
  // What was typed before is kept apart from the first mention.
  expect(await received()).toBe(`look at @${plain} @"${spaced}" @"${folder}/" \n`)
})

test('leaves an image as a path, which an agent takes in as the image', async () => {
  await drop(image)
  expect(await received()).toBe(` ${image} \n`)
})

test('attaches what is chosen by the Attach button', async () => {
  await page.getByRole('button', { name: 'Attach' }).click()
  expect(await received()).toBe(` @"${spaced}" @"${folder}/" \n`)
})
