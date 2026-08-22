import assert from 'node:assert/strict'
import { test } from 'node:test'

import { validateOnlineRelease } from '../src/main/runtime/online-release.ts'

const release = {
  version: '0.1.1-rc.3',
  integrity: `sha512-${Buffer.alloc(64, 7).toString('base64')}`,
  tarballUrl: 'https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-0.1.1-rc.3.tgz',
  releaseTag: 'next',
} as const

test('accepts only the exact official Harness tarball path', () => {
  assert.doesNotThrow(() => validateOnlineRelease(release))
  for (const tarballUrl of [
    'https://example.com/@deepseek-ai/dsh/-/dsh-0.1.1-rc.3.tgz',
    'https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-0.1.1-rc.4.tgz',
    'https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-0.1.1-rc.3.tgz?mirror=1',
  ]) {
    assert.throws(
      () => validateOnlineRelease({ ...release, tarballUrl }),
      /tarball URL is untrusted/u,
    )
  }
})
