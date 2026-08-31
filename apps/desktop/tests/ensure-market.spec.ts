import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { HarnessRuntime } from '../src/main/harness/types.ts'
import { ensureProfileMarket, hasMarketBundle } from '../src/main/profile/ensure-market.ts'

const fakeRuntime: HarnessRuntime = {
  version: '0.1.1-rc.2',
  rootPath: 'C:/runtime',
  nodePath: 'C:/host/node/node.exe',
  dshEntryPath: 'C:/runtime/node_modules/@deepseek-ai/dsh/lib/bin.js',
  pnpmPath: 'C:/host/pnpm/bin/pnpm.cjs',
  ffmpegPath: 'C:/host/ffmpeg/bin/ffmpeg.exe',
  ffprobePath: 'C:/host/ffmpeg/bin/ffprobe.exe',
}

async function freshHome(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'ldd-market-'))
}

async function writeWebManifest(home: string, bundles: readonly string[]): Promise<void> {
  const profileDir = join(home, 'profiles', 'web')
  await mkdir(profileDir, { recursive: true })
  await writeFile(
    join(profileDir, 'package.json'),
    JSON.stringify({ name: 'dsh-profile-web', dsh: { profile: { bundles } } }),
    'utf8',
  )
}

describe('ensure-market', () => {
  it('detects an installed market bundle', async () => {
    const home = await freshHome()
    await writeWebManifest(home, ['@deepseek-ai/dsh-base', 'dshmarket'])
    expect(await hasMarketBundle(home)).toBe(true)
  })

  it('reports missing when the market bundle is absent', async () => {
    const home = await freshHome()
    await writeWebManifest(home, ['@deepseek-ai/dsh-base'])
    expect(await hasMarketBundle(home)).toBe(false)
  })

  it('reports missing when the profile manifest does not exist', async () => {
    const home = await freshHome()
    expect(await hasMarketBundle(home)).toBe(false)
  })

  it('does not run an install when the market is already present', async () => {
    const home = await freshHome()
    await writeWebManifest(home, ['dshmarket'])
    const diagnostics: string[] = []
    await ensureProfileMarket(fakeRuntime, home, (line) => diagnostics.push(line))
    expect(diagnostics).toEqual([])
  })
})
