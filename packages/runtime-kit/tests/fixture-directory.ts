import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface FixtureDirectory extends AsyncDisposable {
  readonly root: string
  path(...segments: string[]): string
}

export async function createFixtureDirectory(prefix: string): Promise<FixtureDirectory> {
  const root = await mkdtemp(join(tmpdir(), prefix))

  return {
    root,
    path: (...segments) => join(root, ...segments),
    async [Symbol.asyncDispose]() {
      await rm(root, { force: true, recursive: true })
    },
  }
}
