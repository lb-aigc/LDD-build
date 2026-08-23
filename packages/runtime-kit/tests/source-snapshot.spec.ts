import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const suppliedArchive = fileURLToPath(
  new URL('../../../vendor/sources/deepseek-harness-0.1.1-rc.2.zip', import.meta.url),
)
const importedPackage = fileURLToPath(
  new URL('../../../upstream/deepseek-harness/package.json', import.meta.url),
)

describe('official Harness source snapshot', () => {
  it('pins the supplied 0.1.1-rc.2 source archive identity', async () => {
    const bytes = await readFile(suppliedArchive)

    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      '47fb7e386c0bd86a6c4341321b8f2915cd6f490a687f8deaf78714e369e4c91d',
    )
  })

  it('imports the official source version without rewriting it', async () => {
    const pkg = JSON.parse(await readFile(importedPackage, 'utf8')) as {
      packageManager?: string
      version?: string
    }

    expect(pkg.version).toBe('0.1.1-rc.2')
    expect(pkg.packageManager).toBe('pnpm@11.7.0')
  })
})
