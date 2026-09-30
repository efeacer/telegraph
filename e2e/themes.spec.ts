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

function colourOf(selector: string, property: 'color' | 'backgroundColor'): Promise<string> {
  return page.locator(selector).first().evaluate((element, which) => getComputedStyle(element)[which], property)
}

function checkedInMenu(): Promise<string | undefined> {
  return app.evaluate(({ Menu }) =>
    ['night', 'dark', 'light', 'creme'].find((name) => Menu.getApplicationMenu()?.getMenuItemById(`theme-${name}`)?.checked)
  )
}

test('starts in the night theme', async () => {
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'night')
  expect(await colourOf('.sidebar', 'backgroundColor')).toBe('rgb(21, 32, 42)')
  expect(await checkedInMenu()).toBe('night')
})

test('changes the window, the terminals and the menu to the theme chosen', async () => {
  await start(page, 'Shell')
  await expect(page.locator('.terminal-view.is-active .xterm-rows')).toContainText('$')
  await choose(page, 'Theme', 'Creme')

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'creme')
  expect(await colourOf('.sidebar', 'backgroundColor')).toBe('rgb(241, 232, 214)')
  // The text of the terminal is in the colours of the theme too.
  await expect.poll(() => colourOf('.terminal-view.is-active .xterm-rows', 'color')).toBe('rgb(52, 41, 31)')
  await expect.poll(checkedInMenu).toBe('creme')
  const background = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getBackgroundColor())
  expect(background.toLowerCase()).toBe('#f1e8d6')
})

test('colours a terminal started after the change', async () => {
  await choose(page, 'Theme', 'Light')
  await start(page, 'Shell')
  await expect.poll(() => colourOf('.terminal-view.is-active .xterm-rows', 'color')).toBe('rgb(27, 36, 48)')
})

test('can be chosen from the menu', async () => {
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('theme-dark')?.click())
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByRole('combobox', { name: 'Theme' })).toHaveText('Dark')
})

test('stays the theme it was left in', async () => {
  await choose(page, 'Theme', 'Light')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await app.close()
  ;({ app, page } = await launch(workspace))
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  expect(await checkedInMenu()).toBe('light')
})
