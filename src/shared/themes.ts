import type { ITheme } from '@xterm/xterm'

export type ThemeName = 'night' | 'dark' | 'light' | 'creme'

export interface Theme {
  name: ThemeName
  /** As the menu and the window name it. */
  label: string
  /** The colour of the window before the page has drawn: that of its sidebar. */
  background: string
}

export const THEMES: Theme[] = [
  { name: 'night', label: 'Night', background: '#15202a' },
  { name: 'dark', label: 'Dark', background: '#1b1b1e' },
  { name: 'light', label: 'Light', background: '#eef0f3' },
  { name: 'creme', label: 'Creme', background: '#f1e8d6' }
]

export const DEFAULT_THEME: ThemeName = 'night'

export function isThemeName(value: unknown): value is ThemeName {
  return THEMES.some((theme) => theme.name === value)
}

const SCROLLBAR = {
  dark: {
    scrollbarSliderBackground: 'rgba(138, 156, 170, 0.22)',
    scrollbarSliderHoverBackground: 'rgba(138, 156, 170, 0.38)',
    scrollbarSliderActiveBackground: 'rgba(138, 156, 170, 0.5)'
  },
  light: {
    scrollbarSliderBackground: 'rgba(60, 60, 60, 0.18)',
    scrollbarSliderHoverBackground: 'rgba(60, 60, 60, 0.3)',
    scrollbarSliderActiveBackground: 'rgba(60, 60, 60, 0.4)'
  }
}

/** The colours of the terminals, in step with the tokens of each theme in styles.css. */
export const TERMINAL_THEMES: Record<ThemeName, ITheme> = {
  night: {
    background: '#0e171f',
    foreground: '#ebe3cf',
    cursor: '#7fd1c4',
    cursorAccent: '#0e171f',
    selectionBackground: '#2f5561',
    selectionInactiveBackground: '#263c47',
    ...SCROLLBAR.dark,
    black: '#1b2935',
    red: '#e5604d',
    green: '#8fcb7a',
    yellow: '#dba544',
    blue: '#6fa8dc',
    magenta: '#c58fd6',
    cyan: '#7fd1c4',
    white: '#cfc8b4',
    brightBlack: '#6a8093',
    brightRed: '#f0806f',
    brightGreen: '#a9db97',
    brightYellow: '#ebc069',
    brightBlue: '#93c0ea',
    brightMagenta: '#d8aee5',
    brightCyan: '#a2e3d8',
    brightWhite: '#f5efdd'
  },
  dark: {
    background: '#121214',
    foreground: '#e8e6e1',
    cursor: '#74cdbd',
    cursorAccent: '#121214',
    selectionBackground: '#33504b',
    selectionInactiveBackground: '#2a3634',
    ...SCROLLBAR.dark,
    black: '#27272c',
    red: '#e8705e',
    green: '#93c97f',
    yellow: '#dcaa4b',
    blue: '#76abdc',
    magenta: '#c897d7',
    cyan: '#74cdbd',
    white: '#cbc9c3',
    brightBlack: '#75757f',
    brightRed: '#f28b7b',
    brightGreen: '#abd99a',
    brightYellow: '#ebc26d',
    brightBlue: '#97c2ea',
    brightMagenta: '#dab2e6',
    brightCyan: '#9fe0d3',
    brightWhite: '#f4f2ee'
  },
  light: {
    background: '#fbfbfc',
    foreground: '#1b2430',
    cursor: '#15776a',
    cursorAccent: '#fbfbfc',
    selectionBackground: '#bfe3dc',
    selectionInactiveBackground: '#dde8e6',
    ...SCROLLBAR.light,
    black: '#1b2430',
    red: '#b83a28',
    green: '#2f7a24',
    yellow: '#8a5d00',
    blue: '#2560a8',
    magenta: '#86419f',
    cyan: '#15776a',
    white: '#aab3bd',
    brightBlack: '#5f6b78',
    brightRed: '#cf4a36',
    brightGreen: '#3b8f2e',
    brightYellow: '#a26f00',
    brightBlue: '#3274c2',
    brightMagenta: '#9c55b6',
    brightCyan: '#1c8c7c',
    brightWhite: '#e9edf1'
  },
  creme: {
    background: '#faf4e6',
    foreground: '#34291f',
    cursor: '#236f64',
    cursorAccent: '#faf4e6',
    selectionBackground: '#e3d4ad',
    selectionInactiveBackground: '#ece2c9',
    ...SCROLLBAR.light,
    black: '#34291f',
    red: '#a93c28',
    green: '#4f711a',
    yellow: '#855a00',
    blue: '#295b8e',
    magenta: '#80417c',
    cyan: '#236f64',
    white: '#c5b594',
    brightBlack: '#6f604c',
    brightRed: '#c04f3a',
    brightGreen: '#5f8622',
    brightYellow: '#9c6c05',
    brightBlue: '#336ea8',
    brightMagenta: '#96558f',
    brightCyan: '#2b8477',
    brightWhite: '#fffaef'
  }
}
