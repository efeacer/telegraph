import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { createWorkspace, launch, recordChat, removeWorkspace, start, type Workspace } from './telegraph'

let workspace: Workspace
let app: ElectronApplication
let page: Page

/** Stands in for Claude: says what it was started with, and leaves a shell to type into. */
const CLAUDE = {
  id: 'claude',
  name: 'Claude',
  command: 'echo companion started with',
  modes: [{ id: 'continue', name: 'continue the last chat', args: '--continue' }],
  chats: { kind: 'claude', flag: '--resume' }
}

function companionDir(): string {
  return join(workspace.userData, 'companion')
}

/** What Claude would answer when asked for the meetings, and which connectors it would list. */
function prepare(options: { agenda?: string; connections?: string } = {}): void {
  const path = join(workspace.userData, 'state.json')
  const state = JSON.parse(readFileSync(path, 'utf8'))
  state.launchers.push(CLAUDE)
  writeFileSync(path, JSON.stringify(state))
  writeFileSync(join(workspace.userData, 'test-agenda.txt'), options.agenda ?? 'EVENTS: []')
  if (options.connections) writeFileSync(join(workspace.userData, 'test-connections.txt'), options.connections)
}

function meetingIn(minutes: number, title = 'Design review'): string {
  const start = new Date(Date.now() + minutes * 60_000)
  const end = new Date(start.getTime() + 60 * 60_000)
  return `EVENTS: ${JSON.stringify([{ title, start: start.toISOString(), end: end.toISOString(), allDay: false }])}`
}

function companion(): ReturnType<Page['locator']> {
  return page.locator('.project.is-companion')
}

function notices(): Promise<{ title: string; body: string }[]> {
  return app.evaluate(() =>
    ((globalThis as Record<string, unknown>).telegraphNotices as { title: string; body: string }[]).map(({ title, body }) => ({ title, body }))
  )
}

test.beforeEach(() => {
  workspace = createWorkspace()
})

test.afterEach(async () => {
  await app.close()
  removeWorkspace(workspace)
})

test('is pinned at the top, and starts by itself without taking the stage', async () => {
  prepare()
  ;({ app, page } = await launch(workspace))
  await expect(page.locator('.project').first()).toHaveClass(/is-companion/)
  await expect(companion().locator('.session')).toHaveCount(1)
  await expect(page.getByRole('heading', { name: 'No session open in signal-box' })).toBeVisible()

  await companion().locator('.session-main').click()
  await expect(page.locator('.terminal-view.is-active .xterm-rows')).toContainText('companion started with')
})

test('goes on with the chat it had before', async () => {
  prepare()
  recordChat(workspace, { id: '11111111-1111-4111-8111-111111111111', title: 'Monday', minutesAgo: 60, folder: companionDir() })
  ;({ app, page } = await launch(workspace))
  await companion().locator('.session-main').click()
  await expect(page.locator('.terminal-view.is-active .xterm-rows')).toContainText('companion started with --continue')
})

test('is briefed, and told of the meetings and the sessions', async () => {
  prepare({ agenda: meetingIn(120, 'Quarterly planning') })
  ;({ app, page } = await launch(workspace))
  expect(readFileSync(join(companionDir(), 'CLAUDE.md'), 'utf8')).toContain('You are the companion in Telegraph')

  await start(page, 'Shell')
  await expect
    .poll(() => (existsSync(join(companionDir(), 'context.md')) ? readFileSync(join(companionDir(), 'context.md'), 'utf8') : ''))
    .toMatch(/Quarterly planning[\s\S]*Shell \(signal-box\): (idle|working)/)
})

test('offers help with a meeting half an hour before it, and asks the companion when taken up', async () => {
  prepare({ agenda: meetingIn(20) })
  ;({ app, page } = await launch(workspace))
  await expect.poll(notices).toEqual([
    { title: expect.stringMatching(/^“Design review” in (19|20) minutes$/), body: expect.stringMatching(/^At \d\d:\d\d\. Want help preparing\? Press to ask your companion\.$/) }
  ])

  await app.evaluate(() => ((globalThis as Record<string, unknown>).telegraphNotices as { press(): void }[])[0]!.press())
  await expect(companion().locator('.session')).toHaveClass(/is-active/)
  await expect(page.locator('.terminal-view.is-active .xterm-rows')).toContainText('Help me prepare for “Design review” at', { timeout: 10_000 })
})

test('shows the next meeting under the companion', async () => {
  prepare({ agenda: meetingIn(90, 'Quarterly planning') })
  ;({ app, page } = await launch(workspace))
  await expect(companion().locator('.companion-next')).toContainText(/Next: Quarterly planning at \d\d:\d\d/)
})

test('says so when the calendar needs signing in to, and signs in from the companion', async () => {
  prepare({ agenda: 'EVENTS: UNAVAILABLE Google Calendar needs authentication' })
  ;({ app, page } = await launch(workspace))
  await expect(companion().locator('.companion-next')).toHaveText('Calendar needs signing in')

  await companion().locator('.companion-next').click()
  const dialog = page.getByRole('dialog', { name: 'Connections' })
  await expect(dialog).toContainText('Google Calendar needs authentication')
  await dialog.getByRole('button', { name: 'Sign in' }).click()
  await expect(dialog).toBeHidden()
  await expect(companion().locator('.session')).toHaveClass(/is-active/)
  await expect(page.locator('.terminal-view.is-active .xterm-rows')).toContainText('/mcp', { timeout: 10_000 })
})

test('lists the connections, and where to add more', async () => {
  prepare({
    agenda: meetingIn(90),
    connections: [
      'claude.ai Gmail: https://gmailmcp.googleapis.com/mcp/v1 - ✔ Connected',
      'claude.ai Google Calendar: https://calendarmcp.googleapis.com/mcp/v1 - ✔ Connected',
      'my-notes: node notes.js - ✗ Failed to connect'
    ].join('\n')
  })
  ;({ app, page } = await launch(workspace))
  await companion().getByRole('button', { name: 'Start a session in Companion' }).click()
  await page.getByRole('menuitem', { name: 'Connections…' }).click()

  const dialog = page.getByRole('dialog', { name: 'Connections' })
  // Kept out of the way, for those who use Claude's own connectors.
  await dialog.getByText('More for Claude').click()
  await expect(dialog.locator('.connections-list').getByRole('listitem')).toHaveText([/Gmail\s*Connected/, /Google Calendar\s*Connected/, /my-notes\s*Not reachable/])
  await expect(dialog).toContainText(/Read 1 meeting at \d\d:\d\d/)
  await expect(dialog.getByRole('button', { name: 'Add Outlook, iCloud and others' })).toBeVisible()
  await expect(companion().getByRole('button', { name: 'Start a session in Companion' })).toBeVisible()
})

test('can be another agent than Claude, and stays the one chosen', async () => {
  prepare()
  const path = join(workspace.userData, 'state.json')
  const state = JSON.parse(readFileSync(path, 'utf8'))
  state.launchers.push({ id: 'codex', name: 'Codex', command: 'echo codex companion' })
  writeFileSync(path, JSON.stringify(state))
  ;({ app, page } = await launch(workspace))
  await expect(companion().locator('.session')).toHaveCount(1)

  // Chosen by starting it in the companion's place.
  await companion().getByRole('button', { name: 'Start a session in Companion' }).click()
  await page.getByRole('menuitem', { name: 'Start Codex' }).click()
  await expect(page.locator('.terminal-view.is-active .xterm-rows')).toContainText('codex companion')
  await app.close()

  ;({ app, page } = await launch(workspace))
  await companion().locator('.session-main').click()
  await expect(page.locator('.terminal-view.is-active .xterm-rows')).toContainText('codex companion')
  expect(readFileSync(join(companionDir(), 'AGENTS.md'), 'utf8')).toContain('telegraph meetings')
})

test('cannot be removed', async () => {
  prepare()
  ;({ app, page } = await launch(workspace))
  await companion().getByRole('button', { name: 'Start a session in Companion' }).click()
  await expect(page.getByRole('menuitem', { name: 'Remove project' })).toHaveCount(0)
})
