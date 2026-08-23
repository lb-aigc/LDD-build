import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { writePortableRuntimePnpmConfig } from '../src/pnpm-runtime-config.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function temporaryRuntime(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ldd-pnpm-runtime-config-'))
  roots.push(root)
  return root
}

describe('portable runtime pnpm configuration', () => {
  it('pins approved internal packages to sorted local archives', async () => {
    const root = await temporaryRuntime()

    await writePortableRuntimePnpmConfig(root, {}, {
      '@ldd/zeta': 'file:packages/ldd-zeta-1.0.0.tgz',
      react: '19.0.0',
      '@deepseek-ai/alpha': 'file:packages/deepseek-ai-alpha-1.0.0.tgz',
    })

    const workspace = await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8')
    expect(workspace).toMatch([
      'overrides:',
      "  '@deepseek-ai/alpha': 'file:packages/deepseek-ai-alpha-1.0.0.tgz'",
      "  '@ldd/zeta': 'file:packages/ldd-zeta-1.0.0.tgz'",
      '',
    ].join('\n'))
    expect(workspace).not.toMatch(/^  'react':/mu)
  })

  it('rejects an internal package that is not backed by a local archive', async () => {
    const root = await temporaryRuntime()

    await expect(writePortableRuntimePnpmConfig(root, {}, {
      '@deepseek-ai/cosmokit': '^1.8.2',
    })).rejects.toThrow(/local runtime archive/u)
  })

  it('rejects an unsafe internal package name', async () => {
    const root = await temporaryRuntime()

    await expect(writePortableRuntimePnpmConfig(root, {}, {
      "@deepseek-ai/bad'name": 'file:packages/deepseek-ai-bad-name-1.0.0.tgz',
    })).rejects.toThrow(/invalid pnpm override selector/u)
  })
})
