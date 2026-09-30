import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GoogleAccount, type GoogleEndpoints } from './account'

const ENDPOINTS: GoogleEndpoints = {
  auth: 'https://auth.test/auth',
  token: 'https://auth.test/token',
  revoke: 'https://auth.test/revoke',
  userinfo: 'https://api.test/userinfo',
  calendar: 'https://api.test/calendar/v3',
  gmail: 'https://api.test/gmail/v1'
}

let directory: string
let time: number

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'telegraph-google-'))
  time = Date.parse('2026-09-30T11:00:00.000Z')
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

/** Google as the tests have it: answers by the path asked for. */
function google(routes: Record<string, unknown | ((url: URL, init?: RequestInit) => unknown)>) {
  const calls: { url: URL; init?: RequestInit }[] = []
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input)
    calls.push({ url, init })
    const route = Object.entries(routes).find(([path]) => `${url.origin}${url.pathname}` === path)
    if (!route) return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 })
    const [, answer] = route
    const body = typeof answer === 'function' ? answer(url, init) : answer
    if (body instanceof Response) return body
    return new Response(JSON.stringify(body), { status: 200 })
  })
  return { fetch, calls }
}

const SIGNED_IN = {
  'https://auth.test/token': { access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600 },
  'https://api.test/userinfo': { email: 'ada@example.com' }
}

function account(fetch: ReturnType<typeof google>['fetch'], changes: Partial<ConstructorParameters<typeof GoogleAccount>[0]> = {}) {
  const opened: string[] = []
  const made = new GoogleAccount({
    filePath: join(directory, 'google.json'),
    client: () => ({ clientId: 'client-1', clientSecret: 'secret' }),
    // Stands in for the keychain: reversible, and not the plain text.
    encrypt: (plain) => Buffer.from([...plain].reverse().join('')),
    decrypt: (sealed) => [...sealed.toString()].reverse().join(''),
    fetch,
    openBrowser: async (url) => {
      opened.push(url)
      const asked = new URL(url)
      // The user signs in, and the browser comes back with the code.
      await globalThis.fetch(`${asked.searchParams.get('redirect_uri')}/?state=${asked.searchParams.get('state')}&code=the-code`)
    },
    now: () => time,
    endpoints: ENDPOINTS,
    ...changes
  })
  return { account: made, opened }
}

describe('GoogleAccount', () => {
  it('cannot connect before Telegraph is registered with Google', async () => {
    const { account: made } = account(google({}).fetch, { client: () => null })
    expect(made.status()).toEqual({ state: 'unconfigured' })
  })

  it('connects by signing in in the browser, once', async () => {
    const { fetch } = google(SIGNED_IN)
    const { account: made, opened } = account(fetch)
    expect(made.status()).toEqual({ state: 'disconnected' })

    await made.connect()
    expect(made.status()).toEqual({ state: 'connected', email: 'ada@example.com' })
    expect(new URL(opened[0]!).searchParams.get('scope')).toContain('https://www.googleapis.com/auth/calendar.readonly')
    expect(new URL(opened[0]!).searchParams.get('scope')).toContain('https://www.googleapis.com/auth/gmail.readonly')
  })

  it('keeps the key sealed, and stays connected across restarts', async () => {
    const { fetch } = google(SIGNED_IN)
    await account(fetch).account.connect()
    const file = readFileSync(join(directory, 'google.json'), 'utf8')
    expect(file).not.toContain('refresh-1')
    expect(account(fetch).account.status()).toEqual({ state: 'connected', email: 'ada@example.com' })
  })

  it('says why connecting did not work', async () => {
    const { fetch } = google({ 'https://auth.test/token': new Response(JSON.stringify({ error: 'invalid_client' }), { status: 401 }) })
    const { account: made } = account(fetch)
    await made.connect()
    expect(made.status()).toEqual({ state: 'disconnected', reason: 'invalid_client' })
  })

  it('reads the meetings of every calendar the user shows', async () => {
    const { fetch, calls } = google({
      ...SIGNED_IN,
      'https://api.test/calendar/v3/users/me/calendarList': {
        items: [
          { id: 'me', summary: 'Me', selected: true },
          { id: 'team@group', summary: 'Team', selected: true }
        ]
      },
      'https://api.test/calendar/v3/calendars/me/events': {
        items: [{ id: 'e2', summary: 'Later', start: { dateTime: '2026-09-30T15:00:00Z' }, end: { dateTime: '2026-09-30T16:00:00Z' } }]
      },
      'https://api.test/calendar/v3/calendars/team%40group/events': {
        items: [
          { id: 'e1', summary: 'Sooner', start: { dateTime: '2026-09-30T13:00:00Z' }, end: { dateTime: '2026-09-30T14:00:00Z' } },
          { id: 'e2', summary: 'Later', start: { dateTime: '2026-09-30T15:00:00Z' }, end: { dateTime: '2026-09-30T16:00:00Z' } }
        ]
      }
    })
    const { account: made } = account(fetch)
    await made.connect()
    const meetings = await made.meetings(time, time + 36 * 3_600_000)
    expect(meetings.map((meeting) => meeting.title)).toEqual(['Sooner', 'Later'])
    const asked = calls.find((call) => call.url.pathname.endsWith('/calendars/me/events'))!
    expect(asked.url.searchParams.get('singleEvents')).toBe('true')
    expect(asked.url.searchParams.get('timeMin')).toBe('2026-09-30T11:00:00.000Z')
    expect(asked.init?.headers).toMatchObject({ authorization: 'Bearer access-1' })
  })

  it('renews the access when it has run out', async () => {
    let issued = 0
    const { fetch } = google({
      'https://auth.test/token': () => ({ access_token: `access-${++issued}`, refresh_token: 'refresh-1', expires_in: 3600 }),
      'https://api.test/userinfo': { email: 'ada@example.com' },
      'https://api.test/calendar/v3/users/me/calendarList': (_url: URL, init?: RequestInit) => ({
        items: [],
        token: (init?.headers as Record<string, string>).authorization
      })
    })
    const { account: made } = account(fetch)
    await made.connect()
    await made.meetings(time, time + 1000)
    time += 2 * 3_600_000
    await made.meetings(time, time + 1000)
    expect(issued).toBe(2)
  })

  it('is disconnected when Google has taken the access back', async () => {
    const { fetch } = google(SIGNED_IN)
    const { account: made } = account(fetch)
    await made.connect()
    time += 2 * 3_600_000
    fetch.mockImplementation(async () => new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }), { status: 400 }))
    await expect(made.meetings(time, time + 1000)).rejects.toThrow(/Connect Google again/)
    expect(made.status()).toMatchObject({ state: 'disconnected' })
  })

  it('finds mail, and reads a message', async () => {
    const encode = (text: string) => Buffer.from(text).toString('base64url')
    const { fetch, calls } = google({
      ...SIGNED_IN,
      'https://api.test/gmail/v1/users/me/messages': { messages: [{ id: 'm1' }] },
      'https://api.test/gmail/v1/users/me/messages/m1': (url: URL) => ({
        id: 'm1',
        snippet: 'Can we move it?',
        payload: {
          headers: [{ name: 'Subject', value: 'Review' }, { name: 'From', value: 'Ada' }],
          mimeType: 'text/plain',
          body: url.searchParams.get('format') === 'full' ? { data: encode('Can we move it to Friday?') } : {}
        }
      })
    })
    const { account: made } = account(fetch)
    await made.connect()
    expect(await made.searchMail('from:ada newer_than:7d')).toEqual([
      { id: 'm1', from: 'Ada', subject: 'Review', date: '', snippet: 'Can we move it?', body: '' }
    ])
    expect(calls.find((call) => call.url.pathname.endsWith('/messages'))!.url.searchParams.get('q')).toBe('from:ada newer_than:7d')
    expect((await made.readMail('m1'))?.body).toBe('Can we move it to Friday?')
  })

  it('refuses an id that could lead elsewhere', async () => {
    const { fetch } = google(SIGNED_IN)
    const { account: made } = account(fetch)
    await made.connect()
    await expect(made.readMail('../../drafts')).rejects.toThrow(/not a message/)
  })

  it('disconnects, and tells Google to forget the access', async () => {
    const { fetch, calls } = google({ ...SIGNED_IN, 'https://auth.test/revoke': {} })
    const { account: made } = account(fetch)
    await made.connect()
    await made.disconnect()
    expect(made.status()).toEqual({ state: 'disconnected' })
    expect(existsSync(join(directory, 'google.json'))).toBe(false)
    expect(calls.some((call) => call.url.toString().startsWith('https://auth.test/revoke'))).toBe(true)
  })
})
