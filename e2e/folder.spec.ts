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

/** The folders the app would have opened. Under test it keeps them to itself, and opens no window of the system. */
function opened(): Promise<string[]> {
  return app.evaluate(() => ((globalThis as Record<string, unknown>).telegraphOpenedFolders as string[] | undefined) ?? [])
}

test('opens the folder of a project', async () => {
  const project = page.locator('.project').filter({ hasText: 'signal-box' })
  const button = project.getByRole('button', { name: 'Open signal-box in Finder' })
  await expect(button).toHaveAttribute('title', /Open the folder of signal-box/)
  await button.click()
  await expect.poll(opened).toEqual([workspace.projectPath])
})

test('opens the folder of the companion too', async () => {
  await page.locator('.project.is-companion').getByRole('button', { name: /^Open Companion in / }).click()
  await expect.poll(opened).toEqual([expect.stringMatching(/companion$/)])
})

test('does not select the project when its folder is opened', async () => {
  await page.locator('.project.is-companion').getByRole('button', { name: /^Open Companion in / }).click()
  await expect(page.getByRole('heading', { name: 'No session open in signal-box' })).toBeVisible()
})
