import { defineConfig } from 'vite'
import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { webApp } from './web/plugin.mjs'

const root = fileURLToPath(new URL('.', import.meta.url))
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

// mode 'web': the iPhone web app for GitLab Pages (dist-web/), with manifest
// and service worker; everything else is the desktop and Android UI (dist/)
export default defineConfig(({ mode }) => ({
  root,
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(version)
  },
  plugins: [
    svelte({
      preprocess: vitePreprocess(),
      onwarn: (warning, handler) => {
        if (warning.code.startsWith('a11y')) return
        handler(warning)
      }
    }),
    mode === 'web' && webApp({ version })
  ],
  build: {
    outDir: mode === 'web' ? 'dist-web' : 'dist',
    emptyOutDir: true,
    // Android System WebView 111+ (color-mix) and iOS Safari 16.4+ (home screen web apps with WebRTC)
    target: mode === 'web' ? ['safari16.4', 'chrome111'] : 'chrome111',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000
  }
}))
