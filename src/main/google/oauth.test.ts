import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { authUrl, createPkce, exchangeCode, listenForCode, refreshAccessToken } from './oauth'

describe('createPkce', () => {
  it('makes a verifier and the challenge that proves it', () => {
    const { verifier, challenge } = createPkce()
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/)
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'))
  })

  it('makes a new one each time', () => {
    expect(createPkce().verifier).not.toBe(createPkce().verifier)
  })
})

describe('authUrl', () => {
  it('asks Google for a code that can be used again and again, to read the calendars and the mail', () => {
    const url = new URL(
      authUrl({ clientId: 'client-1', redirectUri: 'http://127.0.0.1:5555', challenge: 'abc', state: 'xyz', scopes: ['openid', 'email'] })
    )
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'client-1',
      redirect_uri: 'http://127.0.0.1:5555',
      response_type: 'code',
      scope: 'openid email',
      code_challenge: 'abc',
      code_challenge_method: 'S256',
      state: 'xyz',
      access_type: 'offline',
      prompt: 'consent'
    })
  })
})

describe('listenForCode', () => {
  it('takes the code Google sends back to the browser', async () => {
    const listening = await listenForCode({ state: 'xyz' })
    const answer = await fetch(`${listening.redirectUri}/?state=xyz&code=the-code`)
    expect(await listening.code).toBe('the-code')
    expect(answer.status).toBe(200)
    expect(await answer.text()).toContain('You can close this tab')
  })

  it('refuses an answer that is not to what was asked', async () => {
    const listening = await listenForCode({ state: 'xyz' })
    const refused = listening.code.catch((error: Error) => error.message)
    await fetch(`${listening.redirectUri}/?state=other&code=the-code`)
    expect(await refused).toMatch(/not the answer/)
  })

  it('says so when the user said no', async () => {
    const listening = await listenForCode({ state: 'xyz' })
    const refused = listening.code.catch((error: Error) => error.message)
    await fetch(`${listening.redirectUri}/?state=xyz&error=access_denied`)
    expect(await refused).toMatch(/access_denied/)
  })

  it('gives up after a while', async () => {
    const listening = await listenForCode({ state: 'xyz', timeoutMs: 50 })
    await expect(listening.code).rejects.toThrow(/too long/)
  })

  it('listens only on this computer', async () => {
    const listening = await listenForCode({ state: 'xyz', timeoutMs: 50 })
    expect(new URL(listening.redirectUri).hostname).toBe('127.0.0.1')
    await listening.code.catch(() => {})
  })
})

function answering(body: unknown, status = 200) {
  return vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status }))
}

describe('exchangeCode', () => {
  it('trades the code for tokens, with the proof it was asked for', async () => {
    const fetch = answering({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 })
    const tokens = await exchangeCode({
      client: { clientId: 'client-1', clientSecret: 'secret' },
      code: 'the-code',
      verifier: 'the-verifier',
      redirectUri: 'http://127.0.0.1:5555',
      fetch,
      now: () => 1_000
    })
    expect(tokens).toEqual({ accessToken: 'access', refreshToken: 'refresh', expiresAt: 1_000 + 3_600_000 })
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('https://oauth2.googleapis.com/token')
    expect(Object.fromEntries(new URLSearchParams(String(init!.body)))).toEqual({
      grant_type: 'authorization_code',
      code: 'the-code',
      code_verifier: 'the-verifier',
      redirect_uri: 'http://127.0.0.1:5555',
      client_id: 'client-1',
      client_secret: 'secret'
    })
  })

  it('says why Google refused', async () => {
    const fetch = answering({ error: 'invalid_grant', error_description: 'Bad Request' }, 400)
    await expect(
      exchangeCode({ client: { clientId: 'c' }, code: 'x', verifier: 'v', redirectUri: 'r', fetch })
    ).rejects.toThrow('invalid_grant: Bad Request')
  })

  it('refuses tokens without a way to renew them', async () => {
    const fetch = answering({ access_token: 'access', expires_in: 3600 })
    await expect(
      exchangeCode({ client: { clientId: 'c' }, code: 'x', verifier: 'v', redirectUri: 'r', fetch })
    ).rejects.toThrow(/renew/)
  })
})

describe('refreshAccessToken', () => {
  it('renews the access, keeping the refresh token', async () => {
    const fetch = answering({ access_token: 'new-access', expires_in: 1800 })
    expect(await refreshAccessToken({ client: { clientId: 'c', clientSecret: 's' }, refreshToken: 'refresh', fetch, now: () => 0 })).toEqual({
      accessToken: 'new-access',
      expiresAt: 1_800_000
    })
    expect(new URLSearchParams(String(fetch.mock.calls[0]![1]!.body)).get('grant_type')).toBe('refresh_token')
  })

  it('says so when the access was taken back', async () => {
    const fetch = answering({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400)
    await expect(refreshAccessToken({ client: { clientId: 'c' }, refreshToken: 'r', fetch })).rejects.toThrow(/revoked/)
  })
})
