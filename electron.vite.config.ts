import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

const alias = { '@shared': resolve(import.meta.dirname, 'src/shared') }

// The dev server needs inline scripts for React refresh, so the policy is
// only written into the built page.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data:"
].join('; ')

function contentSecurityPolicy(): Plugin {
  return {
    name: 'telegraph:content-security-policy',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY },
          injectTo: 'head-prepend'
        }
      ]
    }
  }
}

export default defineConfig({
  main: {
    resolve: { alias },
    // The bug log says which build a problem came from.
    define: { __BUILT_AT__: JSON.stringify(new Date().toISOString()) }
  },
  preload: {
    resolve: { alias },
    build: {
      rollupOptions: {
        output: { format: 'cjs' }
      }
    }
  },
  renderer: {
    resolve: { alias },
    plugins: [react(), contentSecurityPolicy()]
  }
})
