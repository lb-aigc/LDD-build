import { describe, expect, it } from 'vitest'
import { createFixtureDirectory } from '../../../packages/runtime-kit/tests/fixture-directory.js'
import { RuntimeInstaller, type InstalledRuntime } from '../src/main/runtime/installer.js'
import { createDefaultRuntimeState, readRuntimeState, writeRuntimeState } from '../src/main/runtime/state.js'

const candidate: InstalledRuntime = {
  version: '0.1.1-rc.2',
  path: 'versions/0.1.1-rc.2',
  manifest: {
    formatVersion: 1,
    harnessVersion: '0.1.1-rc.2',
    platform: 'win32',
    arch: 'x64',
    nodeMajor: 24,
    createdAt: '2026-08-22T10:00:00.000Z',
    minimumLddVersion: '0.2.0',
    sourceArchiveSha256:
      '47fb7e386c0bd86a6c4341321b8f2915cd6f490a687f8deaf78714e369e4c91d',
    npmIntegrity: null,
    plugins: [],
    files: [{ path: 'package.json', size: 3, sha256: '2'.repeat(64) }],
  },
}

describe('RuntimeInstaller activation', () => {
  it('keeps active and last-known-good exact when candidate observation fails', async () => {
    await using fixture = await createFixtureDirectory('ldd-installer-')
    const statePath = fixture.path('runtime', 'state.json')
    const before = {
      ...createDefaultRuntimeState(),
      activeVersion: '0.1.1-rc.1',
      lastKnownGoodVersion: '0.1.1-rc.1',
    }
    await writeRuntimeState(statePath, before)
    const events: string[] = []
    const installer = new RuntimeInstaller({
      statePath,
      stagingRoot: fixture.path('runtime', 'staging'),
      versionsRoot: fixture.path('runtime', 'versions'),
      resolveInstalledRuntime: async (version) => (version === candidate.version ? candidate : null),
      lifecycle: {
        stopCurrent: async () => {
          events.push('stop-current')
        },
        startCandidate: async () => ({
          stop: async () => {
            events.push('stop-candidate')
          },
        }),
        restorePrevious: async () => {
          events.push('restore-previous')
        },
      },
    })

    await expect(
      installer.activate(candidate.version, async () => {
        throw new Error('candidate failed')
      }),
    ).rejects.toThrow('candidate failed')

    expect((await readRuntimeState(statePath)).state).toEqual(before)
    expect(events).toEqual([
      'stop-current',
      'stop-candidate',
      'restore-previous',
    ])
  })

  it('commits active and last-known-good only after observation succeeds', async () => {
    await using fixture = await createFixtureDirectory('ldd-installer-')
    const statePath = fixture.path('runtime', 'state.json')
    const before = {
      ...createDefaultRuntimeState(),
      activeVersion: '0.1.1-rc.1',
      lastKnownGoodVersion: '0.1.1-rc.1',
    }
    await writeRuntimeState(statePath, before)
    const installer = new RuntimeInstaller({
      statePath,
      stagingRoot: fixture.path('runtime', 'staging'),
      versionsRoot: fixture.path('runtime', 'versions'),
      resolveInstalledRuntime: async () => candidate,
      lifecycle: {
        stopCurrent: async () => undefined,
        startCandidate: async () => ({ stop: async () => undefined }),
        restorePrevious: async () => undefined,
      },
    })

    await installer.activate(candidate.version, async () => undefined)

    expect((await readRuntimeState(statePath)).state).toEqual({
      ...before,
      activeVersion: candidate.version,
      lastKnownGoodVersion: before.activeVersion,
      pendingVersion: null,
    })
  })
})
