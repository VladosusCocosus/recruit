import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Unit tests exist ONLY for pure functions — the prefilter, the .ics parser, the hash
// route's parse/format pair. Keep it that way: no component tests, no DOM environment.
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@main': resolve(__dirname, 'src/main')
    }
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts']
  }
})
