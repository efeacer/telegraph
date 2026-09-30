import { readFileSync } from 'node:fs'
import type { GoogleClient } from './oauth'

/**
 * Reads how Telegraph is registered with Google: the file Google gives for a
 * desktop app, as it is downloaded, or a file of just its id and secret.
 */
export function readGoogleClient(text: string): GoogleClient | null {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    const inner = (typeof parsed.installed === 'object' && parsed.installed !== null ? parsed.installed : parsed) as Record<string, unknown>
    if (typeof inner.client_id !== 'string' || inner.client_id === '') return null
    return {
      clientId: inner.client_id,
      ...(typeof inner.client_secret === 'string' ? { clientSecret: inner.client_secret } : {})
    }
  } catch {
    return null
  }
}

/** The registration from the first of the files that has one. */
export function loadGoogleClient(paths: string[]): GoogleClient | null {
  for (const path of paths) {
    try {
      const client = readGoogleClient(readFileSync(path, 'utf8'))
      if (client) return client
    } catch {
      // Not there.
    }
  }
  return null
}
