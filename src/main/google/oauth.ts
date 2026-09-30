import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
export const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const WAIT_MS = 5 * 60_000

/** The app as it is registered with Google. A desktop app's secret is not secret, and Google says so. */
export interface GoogleClient {
  clientId: string
  clientSecret?: string
}

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>

/** Proof, sent with the code, that it is Telegraph that asked for it. */
export function createPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

export function authUrl(options: {
  clientId: string
  redirectUri: string
  challenge: string
  state: string
  scopes: string[]
}): string {
  const url = new URL(AUTH_ENDPOINT)
  url.search = new URLSearchParams({
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    response_type: 'code',
    scope: options.scopes.join(' '),
    code_challenge: options.challenge,
    code_challenge_method: 'S256',
    state: options.state,
    // A token that renews itself, so that the user signs in once.
    access_type: 'offline',
    prompt: 'consent'
  }).toString()
  return url.toString()
}

const PAGE = (title: string, text: string): string =>
  `<!doctype html><meta charset="utf-8"><title>Telegraph</title><body style="font:16px system-ui;margin:15vh auto;max-width:28em;text-align:center"><h1 style="font-size:22px">${title}</h1><p>${text}</p></body>`

/**
 * Waits on this computer for the browser to come back from Google with the
 * code. Only the answer to this very question is taken.
 */
export async function listenForCode(options: {
  state: string
  timeoutMs?: number
}): Promise<{ redirectUri: string; code: Promise<string> }> {
  let settle: { resolve(code: string): void; reject(error: Error): void } = { resolve: () => {}, reject: () => {} }
  const code = new Promise<string>((resolve, reject) => (settle = { resolve, reject }))
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const error = url.searchParams.get('error')
    const given = url.searchParams.get('code')
    if (url.searchParams.get('state') !== options.state || (!error && !given)) {
      response.writeHead(400, { 'content-type': 'text/html' }).end(PAGE('That did not work', 'Go back to Telegraph and try again.'))
      finish(new Error('The browser came back with what was not the answer to this sign-in.'))
      return
    }
    if (error) {
      response.writeHead(200, { 'content-type': 'text/html' }).end(PAGE('Not connected', 'You can close this tab and go back to Telegraph.'))
      finish(new Error(`Google said no: ${error}`))
      return
    }
    response.writeHead(200, { 'content-type': 'text/html' }).end(PAGE('Connected', 'You can close this tab and go back to Telegraph.'))
    finish(null, given!)
  })
  const timer = setTimeout(() => finish(new Error('Signing in took too long. Try again.')), options.timeoutMs ?? WAIT_MS)

  function finish(error: Error | null, value?: string): void {
    clearTimeout(timer)
    server.close()
    if (error) settle.reject(error)
    else settle.resolve(value!)
  }

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { redirectUri: `http://127.0.0.1:${port}`, code }
}

async function postToken(fetch: Fetch, form: Record<string, string>, endpoint = TOKEN_ENDPOINT): Promise<Record<string, unknown>> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString()
  })
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok || typeof body.access_token !== 'string') {
    const reason = [body.error, body.error_description].filter((part) => typeof part === 'string').join(': ')
    throw new Error(reason || `Google answered ${response.status}`)
  }
  return body
}

function clientForm(client: GoogleClient): Record<string, string> {
  return { client_id: client.clientId, ...(client.clientSecret ? { client_secret: client.clientSecret } : {}) }
}

function expiry(body: Record<string, unknown>, now: number): number {
  return now + (typeof body.expires_in === 'number' ? body.expires_in : 3600) * 1000
}

export async function exchangeCode(options: {
  client: GoogleClient
  code: string
  verifier: string
  redirectUri: string
  fetch?: Fetch
  now?: () => number
  endpoint?: string
}): Promise<{ accessToken: string; refreshToken: string; expiresAt: number }> {
  const body = await postToken(
    options.fetch ?? fetch,
    {
      grant_type: 'authorization_code',
      code: options.code,
      code_verifier: options.verifier,
      redirect_uri: options.redirectUri,
      ...clientForm(options.client)
    },
    options.endpoint
  )
  if (typeof body.refresh_token !== 'string') throw new Error('Google gave no way to renew the access. Try again.')
  return { accessToken: body.access_token as string, refreshToken: body.refresh_token, expiresAt: expiry(body, (options.now ?? Date.now)()) }
}

export async function refreshAccessToken(options: {
  client: GoogleClient
  refreshToken: string
  fetch?: Fetch
  now?: () => number
  endpoint?: string
}): Promise<{ accessToken: string; expiresAt: number }> {
  const body = await postToken(
    options.fetch ?? fetch,
    { grant_type: 'refresh_token', refresh_token: options.refreshToken, ...clientForm(options.client) },
    options.endpoint
  )
  return { accessToken: body.access_token as string, expiresAt: expiry(body, (options.now ?? Date.now)()) }
}
