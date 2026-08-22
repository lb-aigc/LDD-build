import { describe, expect, it } from 'vitest'
import { RegistryClient } from '../src/main/runtime/registry.js'

describe('official Harness registry', () => {
  it('prerelease channel selects the highest newer exact dsh version', async () => {
    const client = new RegistryClient(async () =>
      new Response(
        JSON.stringify({
          name: '@deepseek-ai/dsh',
          'dist-tags': { next: '0.1.1-rc.2' },
          versions: {
            '0.1.1-rc.1': version('0.1.1-rc.1'),
            '0.1.1-rc.2': version('0.1.1-rc.2'),
          },
        }),
      ),
    )

    await expect(client.resolve('prerelease', '0.1.1-rc.1')).resolves.toMatchObject({
      version: '0.1.1-rc.2',
      releaseTag: 'next',
    })
  })
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
