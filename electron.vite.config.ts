import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const r = (p: string): string => resolve(__dirname, p)

const alias = {
  '@shared': r('src/shared'),
  '@main': r('src/main'),
  '@renderer': r('src/renderer')
}

export default defineConfig({
  main: {
    // Keeps native + node deps (better-sqlite3, keytar, imapflow, MCP sdk) as runtime
    // requires instead of bundling them. Anything in package.json "dependencies" is external.
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: {
      outDir: 'out/main',
      rollupOptions: { input: { index: r('src/main/index.ts') } }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: {
      outDir: 'out/preload',
      rollupOptions: { input: { index: r('src/preload/index.ts') } }
    }
  },
  renderer: {
    root: r('src/renderer'),
    resolve: { alias },
    plugins: [react()],
    build: {
      outDir: 'out/renderer',
      rollupOptions: { input: { index: r('src/renderer/index.html') } }
    }
  }
})
