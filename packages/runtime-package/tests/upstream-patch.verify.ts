import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

import { applyTrackedUpstreamPatches } from '../src/upstream-patches.ts'

const repositoryRoot = resolve(import.meta.dirname, '..', '..', '..')
const officialCatalog = join(
  repositoryRoot,
  'upstream',
  'deepseek-harness',
  'packages',
  'core',
  'session',
  'src',
  'known-event-types.ts',
)
const officialReleaseProcess = join(
  repositoryRoot,
  'upstream',
  'deepseek-harness',
  'scripts',
  'release',
  'process.ts',
)
const officialBrand = join(
  repositoryRoot,
  'upstream',
  'deepseek-harness',
  'packages',
  'client',
  'ui-brand-official',
  'src',
  'client',
  'Brand.tsx',
)
const officialLocales = join(
  repositoryRoot,
  'upstream',
  'deepseek-harness',
  'packages',
  'client',
  'ui-conversation',
  'src',
  'client',
  'locales.ts',
)
const officialHeroShell = join(
  repositoryRoot,
  'upstream',
  'deepseek-harness',
  'packages',
  'client',
  'ui-conversation',
  'src',
  'client',
  'skeleton',
  'HeroShell.module.css',
)
const patchRoot = join(repositoryRoot, 'patches', 'deepseek-harness', '0.1.1-rc.2')

test('tracked Harness patches add LDD compatibility changes and apply exactly once', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'ldd-upstream-patch-'))
  try {
    const copiedRoot = join(parent, 'source')
    const copiedCatalog = join(
      copiedRoot,
      'packages',
      'core',
      'session',
      'src',
      'known-event-types.ts',
    )
    const copiedReleaseProcess = join(copiedRoot, 'scripts', 'release', 'process.ts')
    const copiedBrand = join(
      copiedRoot, 'packages', 'client', 'ui-brand-official', 'src', 'client', 'Brand.tsx',
    )
    const copiedLocales = join(
      copiedRoot, 'packages', 'client', 'ui-conversation', 'src', 'client', 'locales.ts',
    )
    const copiedHeroShell = join(
      copiedRoot, 'packages', 'client', 'ui-conversation', 'src', 'client', 'skeleton', 'HeroShell.module.css',
    )
    await mkdir(dirname(copiedCatalog), { recursive: true })
    await mkdir(dirname(copiedReleaseProcess), { recursive: true })
    await mkdir(dirname(copiedBrand), { recursive: true })
    await mkdir(dirname(copiedLocales), { recursive: true })
    await mkdir(dirname(copiedHeroShell), { recursive: true })
    await writeFile(copiedCatalog, await readFile(officialCatalog))
    await writeFile(copiedReleaseProcess, await readFile(officialReleaseProcess))
    await writeFile(copiedBrand, await readFile(officialBrand))
    await writeFile(copiedLocales, await readFile(officialLocales))
    await writeFile(copiedHeroShell, await readFile(officialHeroShell))

    const applied = await applyTrackedUpstreamPatches(copiedRoot, patchRoot)
    const result = await readFile(copiedCatalog, 'utf8')
    assert.match(result, /'video\/analysis-input'/)
    const releaseModule = await import(pathToFileURL(copiedReleaseProcess).href) as Record<string, unknown>
    const candidate = releaseModule.resolveSpawnInvocation
    assert.equal(typeof candidate, 'function')
    const resolveSpawnInvocation = candidate as (
      command: string,
      args: readonly string[],
      platform: NodeJS.Platform,
      environment: Readonly<NodeJS.ProcessEnv>,
    ) => { readonly command: string; readonly args: readonly string[] }
    assert.deepEqual(resolveSpawnInvocation('pnpm', ['--version'], 'win32', {
      ComSpec: 'C:\\Windows\\System32\\cmd.exe',
    }), {
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', 'pnpm.cmd', '--version'],
    })
    assert.deepEqual(applied.map((entry) => entry.path), [
      '0001-register-video-analysis-input-session-event.patch',
      '0002-launch-package-manager-shims-on-windows.patch',
      '0003-rebrand-ldd.patch',
    ])
    const brand = await readFile(copiedBrand, 'utf8')
    assert.match(brand, /LDD_WORDMARK_PATH/u)
    assert.doesNotMatch(brand, /FishLogo/u)
    const locales = await readFile(copiedLocales, 'utf8')
    assert.match(locales, /'hero\.headline': 'LDD'/u)
    assert.doesNotMatch(locales, /探索未至之境/u)
    const heroShell = await readFile(copiedHeroShell, 'utf8')
    assert.match(heroShell, /grid-template-columns: 47px auto auto/u)
    await assert.rejects(
      applyTrackedUpstreamPatches(copiedRoot, patchRoot),
      /does not match the official source/,
    )
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})
