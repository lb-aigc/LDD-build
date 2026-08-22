import assert from 'node:assert/strict'
import test from 'node:test'

import {
  completeDownload,
  confirmActivation,
  createUpdateFlow,
  requestActivation,
} from '../src/renderer/update/model.ts'

test('a runtime cannot activate before download and two-step confirmation', () => {
  const initial = createUpdateFlow('0.1.1-rc.2')
  assert.throws(() => requestActivation(initial), /downloaded/)
  assert.throws(() => confirmActivation(initial), /confirmation/)

  const downloaded = completeDownload(initial)
  assert.equal(downloaded.confirmingActivation, false)
  assert.throws(() => confirmActivation(downloaded), /confirmation/)

  const requested = requestActivation(downloaded)
  assert.equal(requested.confirmingActivation, true)
  const confirmed = confirmActivation(requested)
  assert.equal(confirmed.version, '0.1.1-rc.2')
  assert.equal(confirmed.next.confirmingActivation, false)
})

test('activation confirmation is bound to the exact downloaded version', () => {
  const requested = requestActivation(completeDownload(createUpdateFlow('0.1.1-rc.2')))
  const replacement = createUpdateFlow('0.2.0-beta.1')
  assert.throws(() => confirmActivation({ ...replacement, confirmingActivation: true }), /downloaded/)
  assert.equal(confirmActivation(requested).version, '0.1.1-rc.2')
})
