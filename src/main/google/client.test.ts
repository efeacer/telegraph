import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadGoogleClient, readGoogleClient } from './client'

let directory: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'telegraph-client-'))
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

describe('readGoogleClient', () => {
  it('reads the file Google gives for a desktop app, as it is downloaded', () => {
    const downloaded = { installed: { client_id: 'id.apps.googleusercontent.com', client_secret: 'GOCSPX-x', redirect_uris: ['http://localhost'] } }
    expect(readGoogleClient(JSON.stringify(downloaded))).toEqual({ clientId: 'id.apps.googleusercontent.com', clientSecret: 'GOCSPX-x' })
  })

  it('reads a file of just the two', () => {
    expect(readGoogleClient(JSON.stringify({ client_id: 'id', client_secret: 's' }))).toEqual({ clientId: 'id', clientSecret: 's' })
  })

  it('reads nothing from what is not one', () => {
    expect(readGoogleClient('{ cut')).toBeNull()
    expect(readGoogleClient(JSON.stringify({ web: {} }))).toBeNull()
  })
})

describe('loadGoogleClient', () => {
  it('takes the first of the places it is looked for', () => {
    writeFileSync(join(directory, 'b.json'), JSON.stringify({ client_id: 'second' }))
    expect(loadGoogleClient([join(directory, 'a.json'), join(directory, 'b.json')])).toEqual({ clientId: 'second' })
  })

  it('has none when there is none', () => {
    expect(loadGoogleClient([join(directory, 'a.json')])).toBeNull()
  })
})
