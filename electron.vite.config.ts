import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

const shared = { '@shared': resolve('src/shared') }
const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }

// Packaged builds load from file:// with no server headers, so the CSP goes
// in a meta tag. Dev skips it: Vite's hot reload injects inline scripts.
const contentSecurityPolicy: Plugin = {
  name: 'content-security-policy',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace(
      '<head>',
      `<head>\n    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:" />`
    )
}

export default defineConfig({
  main: {
    resolve: { alias: shared }
  },
  preload: {
    resolve: { alias: shared }
  },
  renderer: {
    resolve: { alias: { ...shared, '@renderer': resolve('src/renderer') } },
    define: { APP_VERSION: JSON.stringify(version) },
    plugins: [react(), contentSecurityPolicy],
    build: {
      rollupOptions: {
        // The desk app, and the door check-in page the app serves to the tablet.
        input: { index: resolve('src/renderer/index.html'), door: resolve('src/renderer/door.html') }
      }
    }
  }
})
