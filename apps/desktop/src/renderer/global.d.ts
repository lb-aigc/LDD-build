import type { LddRendererApi } from '../main/ipc/contracts.ts'

declare global {
  interface Window {
    readonly ldd: LddRendererApi
  }
}

export {}
