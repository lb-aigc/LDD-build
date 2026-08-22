import { createHash } from 'node:crypto'
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises'
import { isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'

export interface AppliedUpstreamPatch {
  readonly path: string
  readonly sha256: string
  readonly targets: readonly string[]
}

interface ParsedFilePatch {
  readonly path: string
  readonly hunks: readonly ParsedHunk[]
}

interface ParsedHunk {
  readonly oldStart: number
  readonly oldLines: readonly string[]
  readonly newLines: readonly string[]
}

export async function applyTrackedUpstreamPatches(
  sourceRoot: string,
  patchRoot: string,
): Promise<readonly AppliedUpstreamPatch[]> {
  if (!isAbsolute(sourceRoot) || !isAbsolute(patchRoot)) {
    throw new TypeError('upstream patch paths must be absolute')
  }
  await assertDirectory(sourceRoot, 'upstream source root')
  await assertDirectory(patchRoot, 'upstream patch root')
  const patchNames = (await readdir(patchRoot))
    .filter((name) => /^\d{4}[-a-z0-9]+\.patch$/u.test(name))
    .sort()
  if (patchNames.length === 0) throw new Error('upstream patch root contains no tracked patches')

  const applied: AppliedUpstreamPatch[] = []
  for (const patchName of patchNames) {
    const patchPath = join(patchRoot, patchName)
    const serialized = await readFile(patchPath, 'utf8')
    const filePatches = parseUnifiedPatch(serialized)
    const prepared: Array<{ readonly path: string; readonly content: string }> = []
    for (const filePatch of filePatches) {
      const targetPath = resolveInside(sourceRoot, filePatch.path)
      const current = await readFile(targetPath, 'utf8')
      prepared.push({ path: targetPath, content: applyFilePatch(current, filePatch, patchName) })
    }
    for (const target of prepared) await writeFile(target.path, target.content, 'utf8')
    applied.push({
      path: patchName,
      sha256: createHash('sha256').update(serialized).digest('hex'),
      targets: filePatches.map((entry) => entry.path),
    })
  }
  return applied
}

function parseUnifiedPatch(serialized: string): ParsedFilePatch[] {
  if (serialized.includes('\r')) throw new Error('upstream patches must use LF line endings')
  const lines = serialized.endsWith('\n')
    ? serialized.slice(0, -1).split('\n')
    : serialized.split('\n')
  const files: ParsedFilePatch[] = []
  let index = 0
  while (index < lines.length) {
    if (!lines[index]?.startsWith('--- a/')) throw new Error('upstream patch has an invalid old-file header')
    const oldPath = lines[index]?.slice('--- a/'.length) ?? ''
    index += 1
    if (!lines[index]?.startsWith('+++ b/')) throw new Error('upstream patch has an invalid new-file header')
    const newPath = lines[index]?.slice('+++ b/'.length) ?? ''
    if (oldPath !== newPath) throw new Error('upstream patches may not rename files')
    index += 1
    const hunks: ParsedHunk[] = []
    while (index < lines.length && !lines[index]?.startsWith('--- a/')) {
      const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(?: .*)?$/u.exec(lines[index] ?? '')
      if (header === null) throw new Error('upstream patch has an invalid hunk header')
      const oldStart = Number(header[1])
      index += 1
      const oldLines: string[] = []
      const newLines: string[] = []
      while (index < lines.length && !lines[index]?.startsWith('@@ ') && !lines[index]?.startsWith('--- a/')) {
        const line = lines[index] ?? ''
        const marker = line[0]
        const value = line.slice(1)
        if (marker === ' ' || marker === '-') oldLines.push(value)
        if (marker === ' ' || marker === '+') newLines.push(value)
        if (marker !== ' ' && marker !== '-' && marker !== '+') {
          throw new Error('upstream patch contains an unsupported hunk line')
        }
        index += 1
      }
      hunks.push({ oldStart, oldLines, newLines })
    }
    if (oldPath.length === 0 || hunks.length === 0) throw new Error('upstream patch contains an empty file change')
    files.push({ path: oldPath, hunks })
  }
  if (files.length === 0) throw new Error('upstream patch contains no file changes')
  return files
}

function applyFilePatch(current: string, patch: ParsedFilePatch, patchName: string): string {
  const trailingNewline = current.endsWith('\n')
  const lines = trailingNewline ? current.slice(0, -1).split('\n') : current.split('\n')
  let offset = 0
  for (const hunk of patch.hunks) {
    const index = hunk.oldStart - 1 + offset
    const actual = lines.slice(index, index + hunk.oldLines.length)
    if (!sameLines(actual, hunk.oldLines)) {
      throw new Error(`upstream patch ${patchName} does not match the official source at ${patch.path}`)
    }
    lines.splice(index, hunk.oldLines.length, ...hunk.newLines)
    offset += hunk.newLines.length - hunk.oldLines.length
  }
  return `${lines.join('\n')}${trailingNewline ? '\n' : ''}`
}

function resolveInside(root: string, target: string): string {
  const normalized = normalize(target)
  if (normalized.startsWith(`..${sep}`) || normalized === '..' || isAbsolute(normalized)) {
    throw new Error('upstream patch target escapes the source root')
  }
  const resolvedRoot = resolve(root)
  const resolvedTarget = resolve(resolvedRoot, normalized)
  const fromRoot = relative(resolvedRoot, resolvedTarget)
  if (fromRoot.startsWith(`..${sep}`) || fromRoot === '..' || isAbsolute(fromRoot)) {
    throw new Error('upstream patch target escapes the source root')
  }
  return resolvedTarget
}

function sameLines(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

async function assertDirectory(path: string, field: string): Promise<void> {
  const metadata = await lstat(path)
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new Error(`${field} must be a regular directory`)
}
