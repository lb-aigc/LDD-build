import { spawn } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const roots = process.argv.slice(2).map((path) => resolve(path))
if (roots.length === 0) throw new Error('usage: run-node-verifies.mjs <directory> [...]')
const files = []
for (const root of roots) {
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.verify.ts')) files.push(resolve(entry.parentPath, entry.name))
  }
}
files.sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
if (files.length === 0) throw new Error('no *.verify.ts files were found')

const code = await new Promise((resolveExit, reject) => {
  const child = spawn(process.execPath, ['--conditions=source', '--test', ...files], {
    cwd: process.cwd(),
    env: process.env,
    shell: false,
    stdio: 'inherit',
    windowsHide: true,
  })
  child.once('error', reject)
  child.once('close', (exitCode, signal) => {
    if (signal !== null) reject(new Error(`node verifies ended with signal ${signal}`))
    else resolveExit(exitCode ?? 1)
  })
})
process.exitCode = code
