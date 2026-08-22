import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { HarnessSupervisor } from '../src/main/harness/supervisor.js'
import { fakeHarnessRuntime, harnessOptions } from './support/fake-harness.js'

const supervisors: HarnessSupervisor[] = []

afterEach(async () => {
  await Promise.all(supervisors.map(async (supervisor) => supervisor.stop()))
  supervisors.length = 0
})

describe('HarnessSupervisor', () => {
  it('does not attach to an unrelated service on the preferred port', async () => {
    const unrelated = createServer()
    await new Promise<void>((resolve) => unrelated.listen(0, '127.0.0.1', resolve))
    const address = unrelated.address()
    if (address === null || typeof address === 'string') throw new Error('missing test port')
    const supervisor = new HarnessSupervisor()
    supervisors.push(supervisor)

    const handle = await supervisor.start(
      fakeHarnessRuntime(),
      harnessOptions({ preferredPort: address.port }),
    )

    expect(handle.port).not.toBe(address.port)
    await handle.stop()
    await new Promise<void>((resolve, reject) =>
      unrelated.close((error) => (error === undefined ? resolve() : reject(error))),
    )
  })
})
