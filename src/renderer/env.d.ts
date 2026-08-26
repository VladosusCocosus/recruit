/// <reference types="vite/client" />
import type { RecruitApi } from '@shared/types'

declare global {
  interface Window {
    /** Exposed by src/preload/index.ts via contextBridge. The renderer's ONLY door out. */
    recruit: RecruitApi
  }
}

export {}
