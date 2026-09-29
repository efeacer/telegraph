import type { Catalogue, Launcher, Model } from './types'

const MODELS_PER_PROVIDER = 12
const NAME_LENGTH = 80
// Providers write their models in letters, digits and a few signs. Anything
// else is not a name the list should be trusted with.
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@[\]-]{0,99}$/
const DAY = /^\d{4}-\d{2}-\d{2}$/
const DATED_COPY = /-\d{8}$/

export function isModelId(id: string): boolean {
  return MODEL_ID.test(id)
}

/**
 * Reads the list of models.dev, which comes from the network and is taken
 * for nothing more than it can be shown to be.
 */
export function readCatalogue(source: unknown, providers: string[]): Catalogue {
  const catalogue: Catalogue = {}
  for (const provider of providers) {
    const listed = Object.values(recordAt(recordAt(source, provider), 'models')).flatMap(readListed)
    const ids = new Set(listed.map((model) => model.id))
    catalogue[provider] = listed
      .filter((model) => !ids.has(model.id.replace(DATED_COPY, '')) || !DATED_COPY.test(model.id))
      .sort((one, other) => (other.releasedAt ?? '').localeCompare(one.releasedAt ?? ''))
      .slice(0, MODELS_PER_PROVIDER)
  }
  return catalogue
}

/** The model as the list has it, or nothing if an agent has no use for it. */
function readListed(value: unknown): Model[] {
  if (typeof value !== 'object' || value === null) return []
  const { tool_call: usesTools, status, release_date: releasedAt } = value as Record<string, unknown>
  if (usesTools !== true || status === 'deprecated') return []
  const output = recordAt(value, 'modalities').output
  if (!Array.isArray(output) || output.length !== 1 || output[0] !== 'text') return []
  return readModel({ ...value, releasedAt })
}

/**
 * A model from wherever Telegraph reads one: the list, the files it keeps,
 * the window. A model ends up in a command, so nothing is kept that could
 * not be one.
 */
function readModel(value: unknown): Model[] {
  if (typeof value !== 'object' || value === null) return []
  const { id, name, releasedAt } = value as Record<string, unknown>
  if (typeof id !== 'string' || !isModelId(id)) return []
  return [
    {
      id,
      name: typeof name === 'string' && name.trim() !== '' ? name.slice(0, NAME_LENGTH) : id,
      ...(typeof releasedAt === 'string' && DAY.test(releasedAt) ? { releasedAt } : {})
    }
  ]
}

/** The models of a list Telegraph has kept. */
export function readModels(value: unknown): Model[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(readModel).slice(0, MODELS_PER_PROVIDER)
}

function recordAt(value: unknown, key: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return {}
  const found = (value as Record<string, unknown>)[key]
  return typeof found === 'object' && found !== null ? (found as Record<string, unknown>) : {}
}

/** The models to offer for a launcher: its own first, then those of its providers. */
export function modelsFor(launcher: Launcher, catalogue: Catalogue): Model[] {
  if (launcher.command === null || !launcher.modelFlag) return []
  const models = new Map<string, Model>()
  const offered = [
    ...(launcher.models ?? []),
    ...(launcher.providers ?? []).flatMap((provider) => catalogue[provider] ?? [])
  ]
  for (const model of offered) if (!models.has(model.id)) models.set(model.id, model)
  return [...models.values()]
}
