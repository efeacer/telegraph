import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Meeting } from '@shared/agenda'
import type { GoogleStatus } from '@shared/types'
import { readCalendars, readEvents, readMessage, readMessageList, type MailMessage } from './api'
import {
  authUrl,
  createPkce,
  exchangeCode,
  listenForCode,
  refreshAccessToken,
  TOKEN_ENDPOINT,
  type Fetch,
  type GoogleClient
} from './oauth'

/** Read only: Telegraph looks at the calendars and the mail, and changes nothing in them. */
const SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/gmail.readonly'
]
const MOST_CALENDARS = 20
const MOST_MESSAGES = 20
const MESSAGE_ID = /^[A-Za-z0-9]{1,64}$/
// Renewed a minute before it runs out, so that it does not run out on the way.
const EARLY_MS = 60_000

export interface GoogleEndpoints {
  auth: string
  token: string
  revoke: string
  userinfo: string
  calendar: string
  gmail: string
}

export const GOOGLE_ENDPOINTS: GoogleEndpoints = {
  auth: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: TOKEN_ENDPOINT,
  revoke: 'https://oauth2.googleapis.com/revoke',
  userinfo: 'https://openidconnect.googleapis.com/v1/userinfo',
  calendar: 'https://www.googleapis.com/calendar/v3',
  gmail: 'https://gmail.googleapis.com/gmail/v1'
}

export type { GoogleStatus } from '@shared/types'

export interface AccountOptions {
  filePath: string
  client: () => GoogleClient | null
  /** Seals the key to the account, as the keychain of the system does. */
  encrypt(plain: string): Buffer
  decrypt(sealed: Buffer): string
  openBrowser(url: string): Promise<void>
  fetch?: Fetch
  now?: () => number
  endpoints?: GoogleEndpoints
}

interface Kept {
  email: string
  refreshToken: string
}

/**
 * The user's Google account, as Telegraph reaches it: signed in to once in
 * the browser, with a key that renews itself kept sealed on disk. Everything
 * any agent reads of the calendars and the mail goes through here.
 */
export class GoogleAccount {
  private readonly endpoints: GoogleEndpoints
  private readonly fetch: Fetch
  private readonly now: () => number
  private kept: Kept | null
  private access: { token: string; expiresAt: number } | null = null
  private connecting = false
  private reason: string | undefined

  constructor(private readonly options: AccountOptions) {
    this.endpoints = options.endpoints ?? GOOGLE_ENDPOINTS
    this.fetch = options.fetch ?? fetch
    this.now = options.now ?? Date.now
    this.kept = this.read()
  }

  status(): GoogleStatus {
    if (!this.options.client()) return { state: 'unconfigured' }
    if (this.connecting) return { state: 'connecting' }
    if (this.kept) return { state: 'connected', email: this.kept.email }
    return this.reason ? { state: 'disconnected', reason: this.reason } : { state: 'disconnected' }
  }

  /** Signs in in the browser. Never rejects: what went wrong is in the status. */
  async connect(): Promise<void> {
    const client = this.options.client()
    if (!client || this.connecting) return
    this.connecting = true
    this.reason = undefined
    try {
      const { verifier, challenge } = createPkce()
      const state = randomBytes(16).toString('base64url')
      const listening = await listenForCode({ state })
      await this.options.openBrowser(
        authUrl({ clientId: client.clientId, redirectUri: listening.redirectUri, challenge, state, scopes: SCOPES, endpoint: this.endpoints.auth })
      )
      const code = await listening.code
      const tokens = await exchangeCode({
        client,
        code,
        verifier,
        redirectUri: listening.redirectUri,
        fetch: this.fetch,
        now: this.now,
        endpoint: this.endpoints.token
      })
      this.access = { token: tokens.accessToken, expiresAt: tokens.expiresAt }
      const profile = await this.get(this.endpoints.userinfo)
      const email = typeof profile.email === 'string' ? profile.email : 'your Google account'
      this.save({ email, refreshToken: tokens.refreshToken })
    } catch (error) {
      this.access = null
      this.reason = error instanceof Error ? error.message : String(error)
    } finally {
      this.connecting = false
    }
  }

  async disconnect(): Promise<void> {
    const kept = this.kept
    this.forget()
    this.reason = undefined
    if (!kept) return
    // Best done, not needed: the key is gone from this computer either way.
    await this.fetch(`${this.endpoints.revoke}?token=${encodeURIComponent(kept.refreshToken)}`, { method: 'POST' }).catch(() => {})
  }

  /** The meetings of every calendar the user shows, in order, between the two times. */
  async meetings(from: number, to: number): Promise<Meeting[]> {
    const calendars = readCalendars(await this.get(`${this.endpoints.calendar}/users/me/calendarList`)).slice(0, MOST_CALENDARS)
    const found = new Map<string, Meeting>()
    for (const calendar of calendars) {
      const url = new URL(`${this.endpoints.calendar}/calendars/${encodeURIComponent(calendar.id)}/events`)
      url.search = new URLSearchParams({
        timeMin: new Date(from).toISOString(),
        timeMax: new Date(to).toISOString(),
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '50'
      }).toString()
      // One meeting can be in several calendars, as when the team's is shown too.
      for (const meeting of readEvents(await this.get(url.toString()))) found.set(meeting.id, meeting)
    }
    return [...found.values()].sort((one, other) => one.start.localeCompare(other.start))
  }

  /** Finds mail as Gmail's search box does, and gives who wrote, about what, and a snippet. */
  async searchMail(query: string, most = 10): Promise<MailMessage[]> {
    const url = new URL(`${this.endpoints.gmail}/users/me/messages`)
    url.search = new URLSearchParams({ q: query, maxResults: String(Math.min(most, MOST_MESSAGES)) }).toString()
    const ids = readMessageList(await this.get(url.toString()))
    const messages: MailMessage[] = []
    for (const id of ids) {
      const message = readMessage(
        await this.get(`${this.endpoints.gmail}/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`),
        false
      )
      if (message) messages.push(message)
    }
    return messages
  }

  async readMail(id: string): Promise<MailMessage | null> {
    if (!MESSAGE_ID.test(id)) throw new Error(`${id} is not a message.`)
    return readMessage(await this.get(`${this.endpoints.gmail}/users/me/messages/${id}?format=full`))
  }

  private async get(url: string): Promise<Record<string, unknown>> {
    const response = await this.fetch(url, { headers: { authorization: `Bearer ${await this.token()}` } })
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
    if (!response.ok) {
      const message = typeof (body.error as { message?: unknown })?.message === 'string' ? (body.error as { message: string }).message : ''
      throw new Error(message || `Google answered ${response.status}`)
    }
    return body
  }

  private async token(): Promise<string> {
    if (this.access && this.access.expiresAt - EARLY_MS > this.now()) return this.access.token
    const client = this.options.client()
    if (!this.kept || !client) throw new Error('Google is not connected.')
    try {
      const renewed = await refreshAccessToken({
        client,
        refreshToken: this.kept.refreshToken,
        fetch: this.fetch,
        now: this.now,
        endpoint: this.endpoints.token
      })
      this.access = { token: renewed.accessToken, expiresAt: renewed.expiresAt }
      return renewed.accessToken
    } catch (error) {
      if (error instanceof Error && /invalid_grant/.test(error.message)) {
        this.forget()
        this.reason = 'Google took the access back. Connect Google again.'
        throw new Error(this.reason)
      }
      throw error
    }
  }

  private read(): Kept | null {
    try {
      const { email, refreshToken } = JSON.parse(readFileSync(this.options.filePath, 'utf8')) as Record<string, unknown>
      if (typeof email !== 'string' || typeof refreshToken !== 'string') return null
      return { email, refreshToken: this.options.decrypt(Buffer.from(refreshToken, 'base64')) }
    } catch {
      return null
    }
  }

  private save(kept: Kept): void {
    this.kept = kept
    mkdirSync(dirname(this.options.filePath), { recursive: true, mode: 0o700 })
    const sealed = { email: kept.email, refreshToken: this.options.encrypt(kept.refreshToken).toString('base64') }
    writeFileSync(`${this.options.filePath}.tmp`, JSON.stringify(sealed), { mode: 0o600 })
    renameSync(`${this.options.filePath}.tmp`, this.options.filePath)
  }

  private forget(): void {
    this.kept = null
    this.access = null
    rmSync(this.options.filePath, { force: true })
  }
}
