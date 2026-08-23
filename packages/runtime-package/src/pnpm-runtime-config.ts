import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { compareRuntimeNames } from '@ldd/runtime-kit/runtime-manifest'

export async function writePortableRuntimePnpmConfig(
  runtimeRoot: string,
  allowBuilds: Readonly<Record<string, boolean>>,
  dependencies: Readonly<Record<string, string>>,
): Promise<void> {
  const policy = Object.entries(allowBuilds).sort(([left], [right]) => compareRuntimeNames(left, right))
  for (const [selector] of policy) {
    if (!/^[A-Za-z0-9@/._:+-]+$/u.test(selector)) {
      throw new TypeError(`invalid pnpm lifecycle selector: ${selector}`)
    }
  }
  const overrides = Object.entries(dependencies)
    .filter(([name]) => name.startsWith('@deepseek-ai/') || name.startsWith('@ldd/'))
    .sort(([left], [right]) => compareRuntimeNames(left, right))
  for (const [selector, target] of overrides) {
    if (!/^[A-Za-z0-9@/._:+-]+$/u.test(selector)) {
      throw new TypeError(`invalid pnpm override selector: ${selector}`)
    }
    if (!/^file:packages\/[A-Za-z0-9._-]+\.tgz$/u.test(target)) {
      throw new TypeError(`internal package ${selector} must use a local runtime archive`)
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
    'overrides:',
    ...overrides.map(([selector, target]) => `  '${selector}': '${target}'`),
    '',
  ].join('\n'), { mode: 0o600 })
}
