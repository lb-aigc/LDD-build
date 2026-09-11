import { createHash } from 'node:crypto'
import { lstat, readFile, readdir, readlink } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'

import { compareRuntimeNames } from '@ldd/runtime-kit/runtime-manifest'

export const approvedHarnessSourceArchiveSha256 =
  '70a8320dc70d38e15d70d56093c2bab34e08fe83941ce27c34456d85e20febb3'

/** Filled from the approved archive's complete canonical tree, not a mutable build directory. */
export const approvedHarnessSourceTreeSha256 =
  '05bc3e528745202ced00ada7f03527fed1ee9e68765ff50636f0e561bdb45f86'

export async function hashHarnessSourceTree(sourceRoot: string): Promise<string> {
  if (!isAbsolute(sourceRoot)) throw new TypeError('Harness source root must be absolute')
  const root = resolve(sourceRoot)
  const rootMetadata = await lstat(root)
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    throw new Error('Harness source root must be a regular directory')
  }
  const hash = createHash('sha256')
  const identities = new Set<string>()
  const visit = async (directory: string, prefix: string): Promise<void> => {
    const names = (await readdir(directory)).sort(compareRuntimeNames)
    for (const name of names) {
      if (name.includes('/') || name.includes('\\') || name.includes('\u0000')) {
        throw new Error('Harness source tree contains an unsafe filename')
      }
      const relativePath = prefix.length === 0 ? name : `${prefix}/${name}`
      const identity = relativePath.normalize('NFC').toLowerCase()
      if (identities.has(identity)) throw new Error(`Harness source tree has a Windows path collision: ${relativePath}`)
      identities.add(identity)
      const absolutePath = join(directory, name)
      const metadata = await lstat(absolutePath)
      if (metadata.isDirectory()) {
        await visit(absolutePath, relativePath)
        continue
      }
      let data: Buffer
      if (metadata.isSymbolicLink()) {
        // GitHub ZIP symlinks may materialize as a small regular file on Windows.
        data = Buffer.from(await readlink(absolutePath), 'utf8')
      } else if (metadata.isFile()) {
        data = await readFile(absolutePath)
      } else {
        throw new Error(`Harness source tree contains a non-file entry: ${relativePath}`)
      }
      const pathBytes = Buffer.from(relativePath, 'utf8')
      hash.update(Buffer.from(`F${String(pathBytes.length)}:`, 'utf8'))
      hash.update(pathBytes)
      hash.update(Buffer.from(`:${String(data.length)}:`, 'utf8'))
      hash.update(data)
      hash.update(Buffer.from([0]))
    }
  }
  await visit(root, '')
  return hash.digest('hex')
}

export async function assertApprovedHarnessSource(
  sourceRoot: string,
  sourceArchiveSha256: string,
): Promise<void> {
  if (sourceArchiveSha256 !== approvedHarnessSourceArchiveSha256) {
    throw new Error('Harness source archive is not the approved LDD 0.2.0 source')
  }
  const treeSha256 = await hashHarnessSourceTree(sourceRoot)
  if (treeSha256 !== approvedHarnessSourceTreeSha256) {
    throw new Error('Harness source tree does not match the approved source archive contents')
  }
}
