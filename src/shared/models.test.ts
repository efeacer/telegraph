import { describe, expect, it } from 'vitest'
import { isModelId, modelsFor, readCatalogue, readModels } from './models'
import type { Launcher } from './types'

function listed(changes: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'claude-opus-5-5',
    name: 'Claude Opus 5.5',
    release_date: '2026-09-22',
    tool_call: true,
    modalities: { input: ['text'], output: ['text'] },
    ...changes
  }
}

function source(models: Record<string, unknown>[], provider = 'anthropic'): unknown {
  return {
    [provider]: {
      id: provider,
      name: provider,
      models: Object.fromEntries(models.map((model) => [model.id, model]))
    }
  }
}

describe('readCatalogue', () => {
  it('takes the id, name and date of each model', () => {
    expect(readCatalogue(source([listed()]), ['anthropic'])).toEqual({
      anthropic: [{ id: 'claude-opus-5-5', name: 'Claude Opus 5.5', releasedAt: '2026-09-22' }]
    })
  })

  it('takes only the providers that were asked for', () => {
    const both = {
      ...(source([listed()]) as object),
      ...(source([listed({ id: 'gpt-6-sol' })], 'openai') as object)
    }
    expect(Object.keys(readCatalogue(both, ['openai']))).toEqual(['openai'])
  })

  it('has nothing for a provider that is not listed', () => {
    expect(readCatalogue(source([listed()]), ['mistral'])).toEqual({ mistral: [] })
  })

  it('puts the newest model first', () => {
    const catalogue = readCatalogue(
      source([
        listed({ id: 'older', release_date: '2026-02-04' }),
        listed({ id: 'newest', release_date: '2026-09-28' }),
        listed({ id: 'newer', release_date: '2026-07-24' })
      ]),
      ['anthropic']
    )
    expect(catalogue.anthropic?.map((model) => model.id)).toEqual(['newest', 'newer', 'older'])
  })

  it('leaves out models an agent has no use for', () => {
    const catalogue = readCatalogue(
      source([
        listed({ id: 'works' }),
        listed({ id: 'no-tools', tool_call: false }),
        listed({ id: 'speaks', modalities: { output: ['text', 'audio'] } }),
        listed({ id: 'draws', modalities: { output: ['image'] } }),
        listed({ id: 'retired', status: 'deprecated' })
      ]),
      ['anthropic']
    )
    expect(catalogue.anthropic?.map((model) => model.id)).toEqual(['works'])
  })

  it('leaves out the dated copy of a model that is listed without a date', () => {
    const catalogue = readCatalogue(
      source([
        listed({ id: 'claude-opus-4-5', release_date: '2025-11-24' }),
        listed({ id: 'claude-opus-4-5-20251101', release_date: '2025-11-24' }),
        listed({ id: 'claude-old-20240229', release_date: '2024-02-29' })
      ]),
      ['anthropic']
    )
    expect(catalogue.anthropic?.map((model) => model.id)).toEqual([
      'claude-opus-4-5',
      'claude-old-20240229'
    ])
  })

  it('leaves out names that could be read as a command', () => {
    const catalogue = readCatalogue(
      source([listed({ id: 'fine-1.5:free' }), listed({ id: 'opus; rm -rf ~' }), listed({ id: '-x' })]),
      ['anthropic']
    )
    expect(catalogue.anthropic?.map((model) => model.id)).toEqual(['fine-1.5:free'])
  })

  it('uses the id of a model that has no name', () => {
    const catalogue = readCatalogue(source([listed({ name: undefined })]), ['anthropic'])
    expect(catalogue.anthropic?.[0]?.name).toBe('claude-opus-5-5')
  })

  it('cuts a name that goes on and on', () => {
    const catalogue = readCatalogue(source([listed({ name: 'n'.repeat(5000) })]), ['anthropic'])
    expect(catalogue.anthropic?.[0]?.name).toHaveLength(80)
  })

  it('leaves out a date that is not one', () => {
    const catalogue = readCatalogue(source([listed({ release_date: 'd'.repeat(5000) })]), ['anthropic'])
    expect(catalogue.anthropic).toEqual([{ id: 'claude-opus-5-5', name: 'Claude Opus 5.5' }])
  })

  it('keeps at most twelve models of a provider', () => {
    const many = Array.from({ length: 20 }, (_, index) =>
      listed({ id: `model-${index}`, release_date: `2026-01-${String(index + 1).padStart(2, '0')}` })
    )
    const catalogue = readCatalogue(source(many), ['anthropic'])
    expect(catalogue.anthropic).toHaveLength(12)
    expect(catalogue.anthropic?.[0]?.id).toBe('model-19')
  })

  it('reads nothing from what is not a catalogue', () => {
    expect(readCatalogue('<html>', ['anthropic'])).toEqual({ anthropic: [] })
    expect(readCatalogue(null, ['anthropic'])).toEqual({ anthropic: [] })
    expect(readCatalogue({ anthropic: { models: 'none' } }, ['anthropic'])).toEqual({ anthropic: [] })
    expect(readCatalogue({ anthropic: { models: { a: null, b: 'text' } } }, ['anthropic'])).toEqual({
      anthropic: []
    })
  })
})

describe('readModels', () => {
  it('reads the models Telegraph has kept', () => {
    const kept = [{ id: 'opus', name: 'Latest Opus' }, { id: 'swift-5', name: 'Swift 5', releasedAt: '2026-09-01' }]
    expect(readModels(kept)).toEqual(kept)
  })

  it('drops what is not a model', () => {
    expect(readModels([{ id: 'a; rm -rf ~', name: 'Trouble' }, { name: 'Nameless' }, 'text', null])).toEqual([])
    expect(readModels('nonsense')).toEqual([])
  })

  it('reads at most twelve', () => {
    const many = Array.from({ length: 100 }, (_, index) => ({ id: `m-${index}`, name: `M ${index}` }))
    expect(readModels(many)).toHaveLength(12)
  })
})

describe('isModelId', () => {
  it('accepts the names providers give their models', () => {
    for (const id of ['opus', 'opus[1m]', 'gpt-5.6', 'anthropic/claude-opus-5.5:batch', 'a@b_c']) {
      expect(isModelId(id), id).toBe(true)
    }
  })

  it('refuses anything else', () => {
    for (const id of ['', ' ', 'two words', '--flag', 'a;b', '$(x)', 'a'.repeat(200)]) {
      expect(isModelId(id), id).toBe(false)
    }
  })
})

describe('modelsFor', () => {
  const claude: Launcher = {
    id: 'claude',
    name: 'Claude',
    command: 'claude',
    modelFlag: '--model',
    providers: ['anthropic'],
    models: [{ id: 'opus', name: 'Opus, latest' }]
  }
  const catalogue = {
    anthropic: [{ id: 'claude-opus-5-5', name: 'Claude Opus 5.5', releasedAt: '2026-09-22' }],
    openai: [{ id: 'gpt-6-sol', name: 'GPT-6 Sol', releasedAt: '2026-09-22' }]
  }

  it('offers the models of the launcher before those of its providers', () => {
    expect(modelsFor(claude, catalogue).map((model) => model.id)).toEqual(['opus', 'claude-opus-5-5'])
  })

  it('offers the models of the launcher when there is no catalogue', () => {
    expect(modelsFor(claude, {}).map((model) => model.id)).toEqual(['opus'])
  })

  it('offers a model once', () => {
    const twice = { ...claude, models: [{ id: 'claude-opus-5-5', name: 'Opus 5.5, my favourite' }] }
    expect(modelsFor(twice, catalogue)).toEqual([
      { id: 'claude-opus-5-5', name: 'Opus 5.5, my favourite' }
    ])
  })

  it('gathers the models of every provider of the launcher', () => {
    const both = { ...claude, models: [], providers: ['anthropic', 'openai'] }
    expect(modelsFor(both, catalogue).map((model) => model.id)).toEqual([
      'claude-opus-5-5',
      'gpt-6-sol'
    ])
  })

  it('offers nothing for a launcher that takes no model', () => {
    const shell: Launcher = { id: 'shell', name: 'Shell', command: null, providers: ['anthropic'] }
    expect(modelsFor(shell, catalogue)).toEqual([])
  })
})
