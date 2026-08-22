import { describe, expect, it } from 'vitest'
import { runTwoPhaseCandidateHealth } from '../src/main/runtime/health.js'

describe('candidate health', () => {
  it('stops and proves quiescence for fresh and profile-copy phases', async () => {
    const events: string[] = []
    const result = await runTwoPhaseCandidateHealth(
      { version: '0.1.1-rc.2', path: 'runtime' },
      { freshHome: 'fresh', profileCopyHome: 'copy' },
      {
        checkCliVersion: async () => '0.1.1-rc.2',
        start: async (_runtime, phase) => ({
          inspect: async () => {
            events.push(`inspect:${phase.kind}`)
            return evidence(
              phase.kind === 'profile-copy' ? ['third-party-broken'] : [],
            )
          },
          stop: async () => {
            events.push(`stop:${phase.kind}`)
          },
          isQuiescent: async () => true,
        }),
      },
    )

    expect(result.kind).toBe('incompatible-plugins')
    expect(events).toEqual([
      'inspect:fresh',
      'stop:fresh',
      'inspect:profile-copy',
      'stop:profile-copy',
    ])
  })
})

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
