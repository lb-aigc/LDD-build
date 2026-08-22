import type { RuntimeState } from './state.js'

export interface RuntimeCandidate {
  readonly path: string
  readonly valid: boolean
  readonly reason?: string
}

export interface RuntimeFallbackCandidate extends RuntimeCandidate {
  readonly version: string
}

export interface RuntimeInventory {
  readonly external: ReadonlyMap<string, RuntimeCandidate>
  readonly fallback: RuntimeFallbackCandidate | null
}

export type RuntimeSelection =
  | {
      readonly kind: 'external' | 'fallback'
      readonly version: string
      readonly path: string
      readonly reasons: readonly string[]
    }
  | {
      readonly kind: 'failure'
      readonly reasons: readonly string[]
    }

export function selectRuntime(
  state: RuntimeState,
  inventory: RuntimeInventory,
): RuntimeSelection {
  const reasons: string[] = []
  const attempted = new Set<string>()

  for (const [label, version] of [
    ['active', state.activeVersion],
    ['last-known-good', state.lastKnownGoodVersion],
  ] as const) {
    if (version === null || attempted.has(version)) {
      continue
    }
    attempted.add(version)
    const candidate = inventory.external.get(version)
    if (candidate?.valid === true) {
      return {
        kind: 'external',
        version,
        path: candidate.path,
        reasons,
      }
    }
    reasons.push(candidateFailure(label, version, candidate))
  }

  if (inventory.fallback?.valid === true) {
    return {
      kind: 'fallback',
      version: inventory.fallback.version,
      path: inventory.fallback.path,
      reasons,
    }
  }

  if (inventory.fallback === null) {
    reasons.push('fallback: not installed')
  } else {
    reasons.push(
      `fallback ${inventory.fallback.version}: ${inventory.fallback.reason ?? 'integrity check failed'}`,
    )
  }
  return { kind: 'failure', reasons }
}

function candidateFailure(
  label: string,
  version: string,
  candidate: RuntimeCandidate | undefined,
): string {
  if (candidate === undefined) {
    return `${label} ${version}: not installed`
  }
  return `${label} ${version}: ${candidate.reason ?? 'integrity check failed'}`
}
