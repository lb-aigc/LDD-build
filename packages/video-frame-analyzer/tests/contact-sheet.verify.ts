import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildContactSheetCommand,
  planContactSheets,
} from '../src/contact-sheet.ts'

test('keeps a hostile filename as one argv value without a command shell', () => {
  const input = 'C:\\work\\clip"; del C:\\data #.mp4'
  const argv = buildContactSheetCommand(input, [0], 'C:\\temp\\sheet-001.jpg')
  assert.equal(argv.filter((value) => value === input).length, 1)
  assert.equal(argv.includes('cmd.exe'), false)
  assert.equal(argv.includes('powershell.exe'), false)
  assert.equal(argv.includes('/c'), false)
  assert.equal(argv.includes('-c'), false)
})

test('contact sheets are bounded to 3x3 and 16 sheets', () => {
  assert.throws(
    () => buildContactSheetCommand('in.mp4', Array.from({ length: 10 }, (_, index) => index), 'out.jpg'),
    /nine/,
  )
  const planned = planContactSheets(
    'in.mp4',
    Array.from({ length: 144 }, (_, index) => index),
    'C:\\private-task',
  )
  assert.equal(planned.length, 16)
  assert.ok(planned.every((sheet) => sheet.timestamps.length <= 9))
  assert.throws(
    () => planContactSheets('in.mp4', Array.from({ length: 145 }, (_, index) => index), 'C:\\private-task'),
    /144/,
  )
})

test('supports bounded adaptive JPEG quality attempts', () => {
  const argv = buildContactSheetCommand('in.mp4', [0], 'out.jpg', 11)
  assert.equal(argv[argv.indexOf('-q:v') + 1], '11')
  assert.throws(() => buildContactSheetCommand('in.mp4', [0], 'out.jpg', 32), /quality/)
})
