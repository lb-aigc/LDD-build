import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const suppliedArchive = fileURLToPath(
  new URL('../../../vendor/sources/deepseek-harness-0.1.5-rc.1.zip', import.meta.url),
)
const importedPackage = fileURLToPath(
  new URL('../../../upstream/deepseek-harness/package.json', import.meta.url),
)

describe('official Harness source snapshot', () => {
  it('pins the supplied 0.1.5-rc.1 source archive identity', async () => {
    const bytes = await readFile(suppliedArchive)

    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      '70a8320dc70d38e15d70d56093c2bab34e08fe83941ce27c34456d85e20febb3',
    )
  })

  it('imports the official source version without rewriting it', async () => {
    const pkg = JSON.parse(await readFile(importedPackage, 'utf8')) as {
      packageManager?: string
      version?: string
    }

    expect(pkg.version).toBe('0.1.5-rc.1')
    expect(pkg.packageManager).toBe('pnpm@11.7.0')
  })
})
