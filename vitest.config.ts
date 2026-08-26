import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Unit tests exist ONLY for the prefilter and the .ics parser. Keep it that way.
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
