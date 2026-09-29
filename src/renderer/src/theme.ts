import type { ITheme } from '@xterm/xterm'

// Keep in step with the colour tokens in styles.css.
export const TERMINAL_THEME: ITheme = {
  background: '#0e171f',
  foreground: '#ebe3cf',
  cursor: '#7fd1c4',
  cursorAccent: '#0e171f',
  selectionBackground: '#2f5561',
  selectionInactiveBackground: '#263c47',
  scrollbarSliderBackground: 'rgba(138, 156, 170, 0.22)',
  scrollbarSliderHoverBackground: 'rgba(138, 156, 170, 0.38)',
  scrollbarSliderActiveBackground: 'rgba(138, 156, 170, 0.5)',
  black: '#1b2935',
  red: '#e5604d',
  green: '#8fcb7a',
  yellow: '#dba544',
  blue: '#6fa8dc',
  magenta: '#c58fd6',
  cyan: '#7fd1c4',
  white: '#cfc8b4',
  brightBlack: '#5b7082',
  brightRed: '#f0806f',
  brightGreen: '#a9db97',
  brightYellow: '#ebc069',
  brightBlue: '#93c0ea',
  brightMagenta: '#d8aee5',
  brightCyan: '#a2e3d8',
  brightWhite: '#f5efdd'
}

export const TERMINAL_FONT_FAMILY = '"IBM Plex Mono", "SF Mono", Menlo, Monaco, monospace'
export const TERMINAL_FONT_SIZE = 13
