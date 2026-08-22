import assert from 'node:assert/strict'
import test from 'node:test'

import { validateVideoAnalysisInputRecord } from '../src/record-validation.ts'

function fixture(): Record<string, unknown> {
  const image = {
    attachmentId: 'attachment-1',
    mediaType: 'image/jpeg',
    bytes: 1024,
    width: 1552,
    height: 880,
    name: 'sheet-1.jpg',
  }
  const range = { startSeconds: 0, endSeconds: 15 }
  const timestamps = [0, 3, 6, 9, 12]
  return {
    version: 1,
    analysisId: 'analysis-1',
    batchIndex: 0,
    route: { provider: 'deepseek-official', model: 'deepseek-v4-flash-vision-exp' },
    goal: 'Summarize',
    range,
    sampling: { precision: 'balanced', intervalSeconds: 3, timestamps },
    contactSheets: [image],
    system: 'Return JSON.',
    messages: [{
      id: 'message-1',
      role: 'user',
      source: { kind: 'plugin', plugin: 'ldd-video-frame-analyzer' },
      content: [
        { type: 'text', text: JSON.stringify({ goal: 'Summarize', batchIndex: 0, range, timestamps }) },
        { type: 'image', attachment: image },
      ],
    }],
    maxTokens: 2000,
  }
}

test('accepts a fully reconstructable video analysis input record', () => {
  assert.deepEqual(validateVideoAnalysisInputRecord(fixture()), {
    analysisId: 'analysis-1',
    batchIndex: 0,
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash-vision-exp',
  })
})

test('rejects contact-sheet or prompt state that cannot reconstruct the exact call', () => {
  const mismatchedImage = structuredClone(fixture())
  const message = (mismatchedImage.messages as Array<Record<string, unknown>>)[0]
  const content = message?.content as Array<Record<string, unknown>>
  const imageBlock = content[1] as Record<string, unknown>
  imageBlock.attachment = {
    ...(imageBlock.attachment as Record<string, unknown>),
    attachmentId: 'different',
  }
  assert.throws(() => validateVideoAnalysisInputRecord(mismatchedImage), /contact sheet/i)

  const mismatchedPrompt = structuredClone(fixture())
  const promptMessage = (mismatchedPrompt.messages as Array<Record<string, unknown>>)[0]
  const promptContent = promptMessage?.content as Array<Record<string, unknown>>
  promptContent[0] = { type: 'text', text: JSON.stringify({
    goal: 'Summarize',
    batchIndex: 0,
    range: { startSeconds: 0, endSeconds: 15 },
    timestamps: [0, 9],
  }) }
  assert.throws(() => validateVideoAnalysisInputRecord(mismatchedPrompt), /prompt timestamps/i)
})
