const semanticVersionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

interface SemanticVersion {
  readonly major: number
  readonly minor: number
  readonly patch: number
  readonly prerelease: readonly string[]
}

export function compareSemanticVersions(left: string, right: string): number {
  const a = parseSemanticVersion(left)
  const b = parseSemanticVersion(right)
  for (const [leftNumber, rightNumber] of [
    [a.major, b.major],
    [a.minor, b.minor],
    [a.patch, b.patch],
  ] as const) {
    if (leftNumber !== rightNumber) {
      return leftNumber < rightNumber ? -1 : 1
    }
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    if (a.prerelease.length === b.prerelease.length) return 0
    return a.prerelease.length === 0 ? 1 : -1
  }
  const count = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < count; index += 1) {
    const leftIdentifier = a.prerelease[index]
    const rightIdentifier = b.prerelease[index]
    if (leftIdentifier === undefined || rightIdentifier === undefined) {
      return leftIdentifier === undefined ? -1 : 1
    }
    if (leftIdentifier === rightIdentifier) continue
    const leftNumeric = /^\d+$/.test(leftIdentifier)
    const rightNumeric = /^\d+$/.test(rightIdentifier)
    if (leftNumeric && rightNumeric) {
      if (leftIdentifier.length !== rightIdentifier.length) {
        return leftIdentifier.length < rightIdentifier.length ? -1 : 1
      }
      return leftIdentifier < rightIdentifier ? -1 : 1
    }
    if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1
    }
    return leftIdentifier < rightIdentifier ? -1 : 1
  }
  return 0
}

export function isPrereleaseVersion(value: string): boolean {
  return parseSemanticVersion(value).prerelease.length > 0
}

/** True when a version's leading prerelease identifier is `alpha` or `beta`
 * — the earliest, least-stable prerelease tiers. Automatic updates must skip
 * these: an alpha line can reference dependencies that are not yet published
 * at a satisfiable range (observed with dsh@0.1.5-alpha.1, whose peer deps
 * resolve to `@deepseek-ai/dsh-fs@^0.1.5` while only `0.1.5-alpha.1` exists on
 * the registry — so `pnpm install` fails with ERR_PNPM_NO_MATCHING_VERSION). */
export function isAlphaOrBetaPrerelease(value: string): boolean {
  const leading = parseSemanticVersion(value).prerelease[0]
  return leading === 'alpha' || leading === 'beta'
}

export function assertSemanticVersion(value: string): void {
  parseSemanticVersion(value)
}

function parseSemanticVersion(value: string): SemanticVersion {
  const match = semanticVersionPattern.exec(value)
  if (match === null) {
    throw new TypeError(`invalid semantic version: ${value}`)
  }
  const major = parseCoreNumber(match[1], value)
  const minor = parseCoreNumber(match[2], value)
  const patch = parseCoreNumber(match[3], value)
  const prerelease = match[4]?.split('.') ?? []
  for (const identifier of prerelease) {
    if (/^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith('0')) {
      throw new TypeError(`invalid numeric prerelease identifier: ${value}`)
    }
  }
  return { major, minor, patch, prerelease }
}

function parseCoreNumber(value: string | undefined, source: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) {
    throw new TypeError(`semantic version core number is not safe: ${source}`)
  }
  return parsed
}
