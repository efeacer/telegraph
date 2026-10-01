import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { createWorkspace, launch, removeWorkspace, start, type Workspace } from './telegraph'

let workspace: Workspace
let app: ElectronApplication
let page: Page
let google: Server
let base: string
let revoked = false

/** Google as the tests have it: signs in whoever asks, and has one meeting and one message. */
function fakeGoogle(): Promise<void> {
  const meeting = () => {
    const start = new Date(Date.now() + 20 * 60_000)
    return { id: 'e1', summary: 'Design review', start: { dateTime: start.toISOString() }, end: { dateTime: new Date(start.getTime() + 3_600_000).toISOString() } }
  }
  const routes: Record<string, (url: URL) => unknown> = {
    '/token': () => ({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 }),
    '/userinfo': () => ({ email: 'ada@example.com' }),
    '/revoke': () => ((revoked = true), {}),
    '/calendar/v3/users/me/calendarList': () => ({ items: [{ id: 'ada', summary: 'Ada', selected: true }] }),
    '/calendar/v3/calendars/ada/events': () => ({ items: [meeting()] }),
    '/gmail/v1/users/me/messages': () => ({ messages: [{ id: 'm1' }] }),
    '/gmail/v1/users/me/messages/m1': () => ({
      id: 'm1',
      snippet: 'Can we move the review?',
      payload: { headers: [{ name: 'From', value: 'Ada' }, { name: 'Subject', value: 'Moving the review' }], mimeType: 'text/plain', body: { data: Buffer.from('Can we move it to Friday?').toString('base64url') } }
    })
  }
  google = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname === '/auth') {
      // The user signs in, and Google sends the browser back with a code.
      const back = new URL(url.searchParams.get('redirect_uri')!)
      back.search = new URLSearchParams({ state: url.searchParams.get('state')!, code: 'the-code' }).toString()
      response.writeHead(302, { location: back.toString() }).end()
      return
    }
    const route = Object.hasOwn(routes, url.pathname) ? routes[url.pathname] : undefined
    const status = route === undefined ? 404 : 200
    response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(route === undefined ? { error: 'not_found' } : route(url)))
  })
  return new Promise((resolve) =>
    google.listen(0, '127.0.0.1', () => {
      base = `http://127.0.0.1:${(google.address() as AddressInfo).port}`
      resolve()
    })
  )
}

test.beforeEach(async () => {
  workspace = createWorkspace()
  revoked = false
  await fakeGoogle()
})

test.afterEach(async () => {
  await app.close()
  google.close()
  removeWorkspace(workspace)
})

async function openWithGoogle(): Promise<void> {
  ;({ app, page } = await launch(workspace, { TELEGRAPH_TEST_GOOGLE: base }))
}

function pane(): ReturnType<Page['locator']> {
  return page.getByRole('dialog', { name: 'Connections' })
}

async function connect(): Promise<void> {
  await page.getByRole('button', { name: 'Connections' }).click()
  await pane().getByRole('button', { name: 'Connect Google' }).click()
  await expect(pane()).toContainText('Connected as ada@example.com')
}

test('connects Google with one press', async () => {
  await openWithGoogle()
  await connect()
  await expect(pane().getByRole('button', { name: 'Disconnect' })).toBeVisible()
})

test('reads the meetings from Google, and offers help before one', async () => {
  await openWithGoogle()
  await connect()
  await expect(page.locator('.companion-next')).toContainText('Next: Design review')
  await expect
    .poll(() => app.evaluate(() => ((globalThis as Record<string, unknown>).telegraphNotices as { title: string }[]).map((notice) => notice.title)))
    .toContainEqual(expect.stringMatching(/^“Design review” in (19|20) minutes$/))
})

test('lets any program in a session ask for the meetings and the mail', async () => {
  await openWithGoogle()
  await connect()
  await pane().getByRole('button', { name: 'Done' }).click()
  await start(page, 'Shell')
  const rows = page.locator('.terminal-view.is-active .xterm-rows')
  await page.locator('.terminal-view.is-active .xterm-helper-textarea').focus()
  await expect(rows).toContainText('$')
  await page.keyboard.type('telegraph meetings; telegraph mail search from:ada; telegraph mail read m1')
  await page.keyboard.press('Enter')
  await expect(rows).toContainText('Design review', { timeout: 15_000 })
  await expect(rows).toContainText('Moving the review')
  await expect(rows).toContainText('Can we move it to Friday?')
})

test('stays connected across restarts, and disconnects', async () => {
  await openWithGoogle()
  await connect()
  await app.close()
  await openWithGoogle()
  await page.getByRole('button', { name: 'Connections' }).click()
  await expect(pane()).toContainText('Connected as ada@example.com')

  await pane().getByRole('button', { name: 'Disconnect' }).click()
  await expect(pane().getByRole('button', { name: 'Connect Google' })).toBeVisible()
  expect(revoked).toBe(true)
})

test('says what is missing when Telegraph is not registered with Google', async () => {
  ;({ app, page } = await launch(workspace))
  await page.getByRole('button', { name: 'Connections' }).click()
  await expect(pane().getByRole('button', { name: 'Connect Google' })).toBeDisabled()
  await expect(pane()).toContainText('Google needs Telegraph to be registered once')
})

test.describe('setting up Google, once', () => {
  async function unregistered(importFile: string): Promise<void> {
    ;({ app, page } = await launch(workspace, { TELEGRAPH_TEST_IMPORT_FILE: importFile }))
    await page.getByRole('button', { name: 'Connections' }).click()
  }

  test('walks through the registration with Google, a page at a time', async () => {
    const { join } = await import('node:path')
    await unregistered(join(workspace.root, 'none.json'))
    const steps = pane().getByRole('list', { name: 'Setting up Google' }).getByRole('listitem')
    await expect(steps).toHaveCount(4)
    await expect(steps.nth(0)).toContainText('Create a project')
    await expect(steps.nth(0).getByRole('button', { name: 'Open' })).toBeVisible()
    await expect(steps.nth(3)).toContainText('Desktop app')
  })

  test('takes the file Google gave, and then connects', async () => {
    const { writeFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const file = join(workspace.root, 'client_secret_123.apps.googleusercontent.com.json')
    writeFileSync(file, JSON.stringify({ installed: { client_id: '123.apps.googleusercontent.com', client_secret: 'GOCSPX-test' } }))
    await unregistered(file)
    await pane().getByRole('button', { name: 'Choose the downloaded file' }).click()

    await expect(pane().getByRole('button', { name: 'Connect Google' })).toBeEnabled()
    await expect(pane().getByRole('list', { name: 'Setting up Google' })).toHaveCount(0)
    const { readFileSync } = await import('node:fs')
    expect(readFileSync(join(workspace.userData, 'google-oauth.json'), 'utf8')).toContain('123.apps.googleusercontent.com')
  })

  test('says so when the file is not the one Google gives', async () => {
    const { writeFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const file = join(workspace.root, 'other.json')
    writeFileSync(file, JSON.stringify({ web: { something: 'else' } }))
    await unregistered(file)
    await pane().getByRole('button', { name: 'Choose the downloaded file' }).click()
    await expect(pane().getByRole('alert')).toContainText('not the file Google gives for a Desktop app')
    await expect(pane().getByRole('button', { name: 'Connect Google' })).toBeDisabled()
  })
})
