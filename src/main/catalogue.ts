import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { isModelId, readCatalogue } from '@shared/models'
import type { Catalogue, Model } from '@shared/types'

const SOURCE_URL = 'https://models.dev/api.json'
const DAY_MS = 24 * 60 * 60 * 1000
const TIMEOUT_MS = 10_000

interface Answer {
  ok: boolean
  json(): Promise<unknown>
}

export type Fetch = (url: string, options: { signal: AbortSignal }) => Promise<Answer>

export interface CatalogueOptions {
  filePath: string
  /** The providers the launchers name. */
  providers: string[]
  /** Null keeps the catalogue from asking, and it uses what it has kept. */
  fetch: Fetch | null
  now?: () => number
}

interface Kept {
  fetchedAt: number
  providers: Catalogue
}

/**
 * The models of each provider, from a public list that needs no key. Asked
 * for once a day and kept on disk, so that the list is there without a
 * network and without waiting.
 */
export class ModelCatalogue {
  private readonly now: () => number

  constructor(private readonly options: CatalogueOptions) {
    this.now = options.now ?? Date.now
  }

  /** Never rejects. Without a list there is nothing to offer, which is no error. */
  async load(): Promise<Catalogue> {
    const { providers } = this.options
    if (providers.length === 0) return {}

    const kept = this.read()
    if (kept !== null && this.isCurrent(kept)) return kept.providers

    const fetched = await this.ask()
    if (fetched === null) return kept?.providers ?? {}
    this.write({ fetchedAt: this.now(), providers: fetched })
    return fetched
  }

  private isCurrent(kept: Kept): boolean {
    const age = this.now() - kept.fetchedAt
    const complete = this.options.providers.every((provider) => provider in kept.providers)
    return complete && age >= 0 && age < DAY_MS
  }

  /** Null when the list could not be had, or had nothing in it. */
  private async ask(): Promise<Catalogue | null> {
    const { fetch, providers } = this.options
    if (fetch === null) return null
    try {
      const answer = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (!answer.ok) return null
      const catalogue = readCatalogue(await answer.json(), providers)
      // A page that has moved answers too, with no models in it.
      return Object.values(catalogue).some((models) => models.length > 0) ? catalogue : null
    } catch {
      return null
    }
  }

  private read(): Kept | null {
    try {
      const { fetchedAt, providers } = JSON.parse(readFileSync(this.options.filePath, 'utf8')) as {
        fetchedAt: unknown
        providers: unknown
      }
      if (typeof fetchedAt !== 'number' || typeof providers !== 'object' || providers === null) {
        return null
      }
      const kept: Catalogue = {}
      for (const [provider, models] of Object.entries(providers)) {
        if (Array.isArray(models)) kept[provider] = models.filter(isModel)
      }
      return { fetchedAt, providers: kept }
    } catch {
      return null
    }
  }

  private write(kept: Kept): void {
    try {
      mkdirSync(dirname(this.options.filePath), { recursive: true })
      const temporaryPath = `${this.options.filePath}.tmp`
      writeFileSync(temporaryPath, `${JSON.stringify(kept, null, 2)}\n`)
      renameSync(temporaryPath, this.options.filePath)
    } catch {
      // The list is asked for again at the next start.
    }
  }
}

// The file can be edited, and what is in it ends up in a command.
function isModel(value: unknown): value is Model {
  const model = value as Model
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof model.id === 'string' &&
    isModelId(model.id) &&
    typeof model.name === 'string'
  )
}
