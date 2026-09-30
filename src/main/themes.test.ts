import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { THEMES, TERMINAL_THEMES, isThemeName, type ThemeName } from '@shared/themes'

const CSS = readFileSync(join(__dirname, '..', 'renderer', 'src', 'styles.css'), 'utf8')

/** The colour tokens a block of the style sheet sets. */
function tokensOf(selector: string): Record<string, string> {
  const start = CSS.indexOf(`${selector} {`)
  if (start === -1) return {}
  const block = CSS.slice(start, CSS.indexOf('}', start))
  const tokens: Record<string, string> = {}
  for (const [, name, value] of block.matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
    if (/^(#|rgba?\()/.test(value!.trim())) tokens[name!] = value!.trim()
  }
  return tokens
}

function luminance(hex: string): number {
  const channels = hex.replace('#', '').match(/../g)!.map((pair) => parseInt(pair, 16) / 255)
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

function contrast(one: string, other: string): number {
  const [light, dark] = [luminance(one), luminance(other)].sort((a, b) => b - a)
  return (light! + 0.05) / (dark! + 0.05)
}

describe('the themes', () => {
  it('are night, dark, light and creme', () => {
    expect(THEMES.map((theme) => theme.name)).toEqual(['night', 'dark', 'light', 'creme'])
  })

  it('each set every colour of the style sheet', () => {
    const names = Object.keys(tokensOf(':root')).sort()
    expect(names.length).toBeGreaterThan(12)
    for (const { name } of THEMES) {
      expect(Object.keys(tokensOf(`:root[data-theme='${name}']`)).sort(), name).toEqual(names)
    }
  })

  it('tell only what is a theme for one', () => {
    expect(isThemeName('creme')).toBe(true)
    expect(isThemeName('sepia')).toBe(false)
    expect(isThemeName(undefined)).toBe(false)
  })

  for (const { name } of THEMES) {
    describe(name, () => {
      const tokens = tokensOf(`:root[data-theme='${name}']`)
      const color = (token: string): string => tokens[token]!

      it('has text that reads on every surface', () => {
        for (const surface of ['--night', '--night-raised', '--night-pressed', '--well']) {
          expect(contrast(color('--paper'), color(surface)), `text on ${surface}`).toBeGreaterThanOrEqual(7)
          expect(contrast(color('--slate'), color(surface)), `quiet text on ${surface}`).toBeGreaterThanOrEqual(4.5)
        }
      })

      it('has marks that stand out from where they are', () => {
        for (const mark of ['--glass', '--brass', '--stop']) {
          expect(contrast(color(mark), color('--night')), `${mark} on the sidebar`).toBeGreaterThanOrEqual(3)
          expect(contrast(color(mark), color('--night-raised')), `${mark} on a panel`).toBeGreaterThanOrEqual(3)
        }
        expect(contrast('#ffffff', color('--stop')), 'the count on a red badge').toBeGreaterThanOrEqual(3)
      })

      it('has a terminal of the same colours as the window', () => {
        const terminal = TERMINAL_THEMES[name as ThemeName]
        expect(terminal.background).toBe(color('--well'))
        expect(terminal.foreground).toBe(color('--paper'))
        expect(THEMES.find((theme) => theme.name === name)!.background).toBe(color('--night'))
      })

      it('has a terminal whose colours read on it', () => {
        const terminal = TERMINAL_THEMES[name as ThemeName]
        expect(contrast(terminal.foreground!, terminal.background!)).toBeGreaterThanOrEqual(7)
        // Black and white are the colours a program draws on and in, not with, on one of the two sorts of theme.
        const used = ['red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'brightBlack'] as const
        for (const colour of used) {
          expect(contrast(terminal[colour]!, terminal.background!), colour).toBeGreaterThanOrEqual(3)
        }
      })
    })
  }
})
