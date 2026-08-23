import type { RuntimeArchiveLimits } from './archive.ts'

export const runtimeArchiveLimits = {
  maxEntries: 100_000,
  maxFileBytes: 512 * 1024 * 1024,
  maxTotalBytes: 3 * 1024 * 1024 * 1024,
  maxCompressedBytes: 1024 * 1024 * 1024,
} as const satisfies RuntimeArchiveLimits
