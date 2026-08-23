import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { compareRuntimeNames } from '@ldd/runtime-kit/runtime-manifest'

export async function writePortableRuntimePnpmConfig(
  runtimeRoot: string,
  allowBuilds: Readonly<Record<string, boolean>>,
): Promise<void> {
  const policy = Object.entries(allowBuilds).sort(([left], [right]) => compareRuntimeNames(left, right))
  for (const [selector] of policy) {
    if (!/^[A-Za-z0-9@/._:+-]+$/u.test(selector)) {
      throw new TypeError(`invalid pnpm lifecycle selector: ${selector}`)
    }
  }
  await writeFile(join(runtimeRoot, '.npmrc'), '', { mode: 0o600 })
  await writeFile(join(runtimeRoot, 'pnpm-workspace.yaml'), [
    'packages: []',
    'nodeLinker: hoisted',
    'packageImportMethod: copy',
    'sharedWorkspaceLockfile: false',
    'preferSymlinkedExecutables: false',
    'allowBuilds:',
    ...policy.map(([selector, allowed]) => `  '${selector}': ${String(allowed)}`),
    '',
  ].join('\n'), { mode: 0o600 })
}

