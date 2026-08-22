import { describe, expect, it } from 'vitest'
import { probeHarnessIdentity } from '../src/main/harness/identity.js'

describe('probeHarnessIdentity', () => {
  it('accepts only a loopback LDD nonce response', async () => {
    const identity = await probeHarnessIdentity('http://127.0.0.1:3080', 'nonce-123', {
      expectedPid: 42,
      fetch: async () =>
        new Response(
          JSON.stringify({ product: 'LDD-Harness', nonce: 'nonce-123', pid: 42 }),
          { status: 200 },
        ),
    })
    expect(identity.pid).toBe(42)
  })

  it('rejects non-loopback targets before fetching', async () => {
    let fetched = false
    await expect(
      probeHarnessIdentity('http://example.com:3080', 'nonce-123', {
        fetch: async () => {
          fetched = true
          return new Response('{}')
        },
      }),
    ).rejects.toThrow('loopback')
    expect(fetched).toBe(false)
  })
})
