import assert from 'node:assert/strict'
import test from 'node:test'
import { createFixtureDirectory } from '../../../packages/runtime-kit/tests/fixture-directory.ts'
import { runTwoPhaseCandidateHealth } from '../src/main/runtime/health.ts'
import { RegistryClient } from '../src/main/runtime/registry.ts'
import { createDefaultRuntimeState, readRuntimeState, writeRuntimeState } from '../src/main/runtime/state.ts'
import { RuntimeUpdater } from '../src/main/runtime/updater.ts'

test('registry selects an exact higher prerelease and rejects floating metadata', async () => {
  const client = new RegistryClient(async () =>
    new Response(
      JSON.stringify({
        name: '@deepseek-ai/dsh',
        'dist-tags': { next: '0.1.1-rc.2' },
        versions: {
          '0.1.1-rc.1': version('0.1.1-rc.1'),
          '0.1.1-rc.2': version('0.1.1-rc.2'),
          '0.2.0': version('0.2.0'),
        },
      }),
    ),
  )
  assert.deepEqual(await client.resolve('prerelease', '0.1.1-rc.1'), {
    version: '0.1.1-rc.2',
    integrity: version('0.1.1-rc.2').dist.integrity,
    tarballUrl: version('0.1.1-rc.2').dist.tarball,
    releaseTag: 'next',
  })
  assert.equal(await client.resolve('prerelease', '0.1.1-rc.2'), null)
})

test('automatic registry checks are limited to one attempt in 24 hours', async () => {
  await using fixture = await createFixtureDirectory('ldd-updater-verify-')
  const statePath = fixture.path('state.json')
  await writeRuntimeState(statePath, createDefaultRuntimeState())
  let calls = 0
  const updater = new RuntimeUpdater({
    statePath,
    now: () => new Date('2026-08-22T10:00:00.000Z'),
    registry: {
      resolve: async () => {
        calls += 1
        return null
      },
    },
  })

  assert.equal((await updater.checkForUpdates('0.1.1-rc.2', false)).kind, 'up-to-date')
  assert.equal((await updater.checkForUpdates('0.1.1-rc.2', false)).kind, 'skipped')
  assert.equal(calls, 1)
  assert.equal((await readRuntimeState(statePath)).state.lastCheckAt, '2026-08-22T10:00:00.000Z')
})

test('two-phase health always stops before reporting incompatible profile plugins', async () => {
  const events: string[] = []
  const result = await runTwoPhaseCandidateHealth(
    { version: '0.1.1-rc.2', path: 'runtime' },
    { freshHome: 'fresh', profileCopyHome: 'copy' },
    {
      checkCliVersion: async () => '0.1.1-rc.2',
      start: async (_runtime, phase) => ({
        inspect: async () => {
          events.push(`inspect:${phase.kind}`)
          return evidence(phase.kind === 'profile-copy' ? ['third-party-broken'] : [])
        },
        stop: async () => {
          events.push(`stop:${phase.kind}`)
        },
        isQuiescent: async () => true,
      }),
    },
  )
  assert.deepEqual(result, {
    kind: 'incompatible-plugins',
    incompatiblePlugins: ['third-party-broken'],
  })
  assert.deepEqual(events, [
    'inspect:fresh',
    'stop:fresh',
    'inspect:profile-copy',
    'stop:profile-copy',
  ])
})

test('a failing health inspection is still stopped and checked for quiescence', async () => {
  const events: string[] = []
  await assert.rejects(
    () =>
      runTwoPhaseCandidateHealth(
        { version: '0.1.1-rc.2', path: 'runtime' },
        { freshHome: 'fresh', profileCopyHome: 'copy' },
        {
          checkCliVersion: async () => '0.1.1-rc.2',
          start: async () => ({
            inspect: async () => {
              throw new Error('manifest missing')
            },
            stop: async () => {
              events.push('stop')
            },
            isQuiescent: async () => {
              events.push('quiescent')
              return true
            },
          }),
        },
      ),
    /fresh candidate health check failed/,
  )
  assert.deepEqual(events, ['stop', 'quiescent'])
})

function version(value: string) {
  return {
    name: '@deepseek-ai/dsh',
    version: value,
    dist: {
      integrity: `sha512-${Buffer.from(value).toString('base64')}`,
      tarball: `https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-${value}.tgz`,
    },
  }
}

function evidence(incompatiblePlugins: string[]) {
  return {
    boundHost: '127.0.0.1',
    webRootOk: true,
    apiManifestOk: true,
    textModelDeclared: true,
    visionModelDeclared: true,
    videoToolRegistered: true,
    pluginListOk: true,
    incompatiblePlugins,
  }
}
