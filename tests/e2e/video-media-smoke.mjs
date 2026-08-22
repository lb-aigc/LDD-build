import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildContactSheetCommand } from '../../packages/video-frame-analyzer/src/contact-sheet.ts'

const ffmpeg = process.env.LDD_TEST_FFMPEG ?? 'ffmpeg'
const root = await mkdtemp(join(tmpdir(), 'ldd-video-smoke-'))
try {
  const input = join(root, 'input.mp4')
  const output = join(root, 'sheet.jpg')
  await run(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=12:duration=4',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', input,
  ])
  await run(ffmpeg, buildContactSheetCommand(input, [0.25, 1.5, 3.25], output))
  const metadata = await stat(output)
  assert.equal(metadata.isFile(), true)
  assert.ok(metadata.size > 0)
  assert.ok(metadata.size <= 3 * 500 * 1024)
  process.stdout.write(`video media smoke passed (${String(metadata.size)} bytes)\n`)
} finally {
  await rm(root, { recursive: true, force: true })
}
async function run(executable, args) {
  await new Promise((resolveRun, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-64 * 1024)
    })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) resolveRun()
      else reject(new Error(`${executable} failed (${String(code)}/${String(signal)}): ${stderr.trim()}`))
    })
  })
}
