import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { createWorkspace, launch, removeWorkspace, type Workspace } from './telegraph'

let workspace: Workspace
let app: ElectronApplication
let page: Page

test.beforeEach(async () => {
  workspace = createWorkspace()
  const path = join(workspace.userData, 'state.json')
  const state = JSON.parse(readFileSync(path, 'utf8'))
  for (const name of ['depot', 'yard']) {
    mkdirSync(join(workspace.root, name))
    state.projects.push({ id: name, name, path: join(workspace.root, name) })
  }
  writeFileSync(path, JSON.stringify(state))
  ;({ app, page } = await launch(workspace))
})

test.afterEach(async () => {
  await app.close()
  removeWorkspace(workspace)
})

function projectNames(): Promise<string[]> {
  return page.locator('.project:not(.is-companion) .project-title').allInnerTexts()
}

function project(name: string): ReturnType<Page['locator']> {
  return page.locator('.project').filter({ has: page.locator('.project-title', { hasText: name }) })
}

async function startShells(name: string, labels: string[]): Promise<void> {
  for (const label of labels) {
    const before = await page.locator('.session').count()
    await project(name).getByRole('button', { name: `Start a session in ${name}` }).click()
    await page.getByRole('menuitem', { name: 'Start Shell' }).click()
    await expect(page.locator('.session')).toHaveCount(before + 1)
    await page.locator('.session.is-active .session-title').dblclick()
    await page.getByRole('textbox', { name: 'Name of the session' }).fill(label)
    await page.keyboard.press('Enter')
  }
}

function sessionNames(name: string): Promise<string[]> {
  return project(name).locator('.session-title').allInnerTexts()
}

test('moves a project by dragging it, and keeps it there', async () => {
  await expect.poll(projectNames).toEqual(['signal-box', 'depot', 'yard'])
  await project('yard').locator('.project-head').dragTo(project('signal-box').locator('.project-head'), { targetPosition: { x: 40, y: 2 } })
  await expect.poll(projectNames).toEqual(['yard', 'signal-box', 'depot'])

  await app.close()
  ;({ app, page } = await launch(workspace))
  await expect.poll(projectNames).toEqual(['yard', 'signal-box', 'depot'])
})

test('keeps the companion first', async () => {
  await project('depot').locator('.project-head').dragTo(page.locator('.project.is-companion .project-head'), { targetPosition: { x: 40, y: 2 } })
  await expect(page.locator('.project').first()).toHaveClass(/is-companion/)
  await expect.poll(projectNames).toEqual(['depot', 'signal-box', 'yard'])
})

test('moves a chat within its project by dragging it', async () => {
  await startShells('signal-box', ['one', 'two', 'three'])
  await expect.poll(() => sessionNames('signal-box')).toEqual(['one', 'two', 'three'])
  const rows = project('signal-box').locator('.session')
  await rows.nth(2).dragTo(rows.nth(0), { targetPosition: { x: 60, y: 2 } })
  await expect.poll(() => sessionNames('signal-box')).toEqual(['three', 'one', 'two'])

  // The order is the order of ⌘1, ⌘2 and ⌘3 too.
  await app.evaluate(({ Menu }) => {
    const view = Menu.getApplicationMenu()?.items.find((item) => item.label === 'View')
    view?.submenu?.items.find((item) => item.label === 'Session 1')?.click()
  })
  await expect(page.locator('.session.is-active .session-title')).toHaveText('three')
})

test('does not move a chat into another project', async () => {
  await startShells('signal-box', ['here'])
  await startShells('depot', ['there'])
  await project('signal-box').locator('.session').dragTo(project('depot').locator('.session'))
  await expect.poll(() => sessionNames('signal-box')).toEqual(['here'])
  await expect.poll(() => sessionNames('depot')).toEqual(['there'])
})

test('moves with the keyboard too', async () => {
  await startShells('signal-box', ['one', 'two'])
  await project('signal-box').locator('.session').nth(1).locator('.session-main').focus()
  await page.keyboard.press('Alt+ArrowUp')
  await expect.poll(() => sessionNames('signal-box')).toEqual(['two', 'one'])

  await project('yard').locator('.project-name').focus()
  await page.keyboard.press('Alt+ArrowUp')
  await expect.poll(projectNames).toEqual(['signal-box', 'yard', 'depot'])
})

test('shows the new order in the other windows', async () => {
  const opened = app.waitForEvent('window')
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('new-window')?.click())
  const second = await opened
  await expect(second.locator('.project-title').first()).toBeVisible()
  await project('yard').locator('.project-head').dragTo(project('signal-box').locator('.project-head'), { targetPosition: { x: 40, y: 2 } })
  await expect.poll(() => second.locator('.project:not(.is-companion) .project-title').allInnerTexts()).toEqual(['yard', 'signal-box', 'depot'])
})

test('types nothing into a terminal a chat is dropped on', async () => {
  await startShells('signal-box', ['one', 'two'])
  const before = await page.locator('.terminal-view.is-active .xterm-rows').innerText()
  await project('signal-box').locator('.session').nth(0).dragTo(page.locator('.terminal-view.is-active'))
  await page.waitForTimeout(500)
  expect(await page.locator('.terminal-view.is-active .xterm-rows').innerText()).toBe(before)
})
