import { defineConfig } from 'vite'
import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root,
  base: './',
  plugins: [
    svelte({
      preprocess: vitePreprocess(),
      onwarn: (warning, handler) => {
        if (warning.code.startsWith('a11y')) return
        handler(warning)
      }
    })
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome130',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000
  }
})
