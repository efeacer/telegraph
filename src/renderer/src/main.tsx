import '@fontsource-variable/archivo/wdth.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/400-italic.css'
import '@fontsource/ibm-plex-mono/700.css'
import '@fontsource/ibm-plex-mono/700-italic.css'
import './styles.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { initialize } from './controller'
import { TERMINAL_FONT_SIZE } from './theme'

// Terminals draw their text onto a canvas and cache every glyph, so a font
// that arrives late would leave them with the fallback's letterforms. The
// sample covers the Latin and extended Latin files of the font.
const FONT_SAMPLE = 'aşğı'
const TERMINAL_FONT_STYLES = ['normal 400', 'italic 400', 'normal 700', 'italic 700']

async function loadTerminalFonts(): Promise<void> {
  await Promise.allSettled(
    TERMINAL_FONT_STYLES.map((style) =>
      document.fonts.load(`${style} ${TERMINAL_FONT_SIZE}px "IBM Plex Mono"`, FONT_SAMPLE)
    )
  )
}

async function start(): Promise<void> {
  await loadTerminalFonts()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
  await initialize()
}

void start()
