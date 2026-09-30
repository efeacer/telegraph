import { describe, expect, it } from 'vitest'
import { tidyName } from './names'

describe('tidyName', () => {
  it('keeps a name as it was typed', () => {
    expect(tidyName('Fix the seat picker – ş')).toBe('Fix the seat picker – ş')
  })

  it('makes one line of it, without room around it', () => {
    expect(tidyName('  two\nlines\r\n and\ttabs ')).toBe('two lines and tabs')
  })

  it('leaves out what a terminal would take for a key', () => {
    expect(tidyName('name\u0003 with\u001b[31m keys\u0007')).toBe('name with[31m keys')
  })

  it('cuts a name that goes on and on', () => {
    expect(tidyName('n'.repeat(500))).toHaveLength(100)
  })

  it('is nothing for a name that is nothing', () => {
    expect(tidyName('   ')).toBeNull()
    expect(tidyName('\n\u0003')).toBeNull()
  })
})
