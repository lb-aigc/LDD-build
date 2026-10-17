import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { ensureGenerateBundle } from '../src/main/profile/ensure-generate.ts'

const GENERATE_BUNDLE = '@ldd/dsh-generate'

async function freshHome(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'ldd-generate-'))
}

async function writeWebManifest(home: string, bundles: readonly unknown[]): Promise<void> {
  const profileDir = join(home, 'profiles', 'web')
  await mkdir(profileDir, { recursive: true })
  await writeFile(
    join(profileDir, 'package.json'),
    JSON.stringify({ name: 'dsh-profile-web', dsh: { profile: { bundles } } }),
    'utf8',
  )
}

async function readBundles(home: string): Promise<unknown> {
  const manifest = JSON.parse(await readFile(join(home, 'profiles', 'web', 'package.json'), 'utf8')) as {
    dsh: { profile: { bundles: unknown } }
  }
  return manifest.dsh.profile.bundles
}

describe('ensure-generate', () => {
  it('appends the generate bundle when absent', async () => {
    const home = await freshHome()
    await writeWebManifest(home, ['@deepseek-ai/dsh-base', 'dshmarket'])
    const diagnostics: string[] = []
    await ensureGenerateBundle(home, (line) => diagnostics.push(line))
    expect(await readBundles(home)).toEqual(['@deepseek-ai/dsh-base', 'dshmarket', GENERATE_BUNDLE])
    expect(diagnostics.length).toBe(1)
  })

  it('leaves the manifest untouched when the bundle is already present', async () => {
    const home = await freshHome()
    await writeWebManifest(home, ['@deepseek-ai/dsh-base', GENERATE_BUNDLE])
    const diagnostics: string[] = []
    await ensureGenerateBundle(home, (line) => diagnostics.push(line))
    expect(await readBundles(home)).toEqual(['@deepseek-ai/dsh-base', GENERATE_BUNDLE])
    expect(diagnostics).toEqual([])
  })

  it('does not throw when the profile manifest is missing', async () => {
    const home = await freshHome()
    const diagnostics: string[] = []
    await ensureGenerateBundle(home, (line) => diagnostics.push(line))
    expect(diagnostics).toEqual([])
  })
})
