import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const suppliedArchive = fileURLToPath(
  new URL('../../../vendor/sources/deepseek-harness-0.2.1-rc.2.zip', import.meta.url),
)
const importedPackage = fileURLToPath(
  new URL('../../../upstream/deepseek-harness/package.json', import.meta.url),
)

describe('official Harness source snapshot', () => {
  it('pins the supplied 0.2.1-rc.2 source archive identity', async () => {
    const bytes = await readFile(suppliedArchive)

    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      '8a096c8f743c2510c04028622bdf48e1a956eaf1bcc3f94bd726360b5e7ca14e',
    )
  })

  it('imports the official source version without rewriting it', async () => {
    const pkg = JSON.parse(await readFile(importedPackage, 'utf8')) as {
      packageManager?: string
      version?: string
    }

    expect(pkg.version).toBe('0.2.1-rc.2')
    expect(pkg.packageManager).toBe('pnpm@11.28.5')
  })
})
