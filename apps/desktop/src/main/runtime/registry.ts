import type { RuntimeChannel } from './state.ts'
import {
  assertSemanticVersion,
  compareSemanticVersions,
  isPrereleaseVersion,
} from './semver.ts'

const registryUrl = 'https://registry.npmjs.org/@deepseek-ai%2Fdsh'
const packageName = '@deepseek-ai/dsh'
const integrityPattern = /^sha512-[A-Za-z0-9+/]+={0,2}$/
const maxRegistryResponseBytes = 16 * 1024 * 1024
const firstUnsupportedHarnessVersion = '0.2.0'

export interface ResolvedRuntimeRelease {
  readonly version: string
  readonly integrity: string
  readonly tarballUrl: string
  readonly releaseTag: string
}

export interface RuntimeRegistry {
  resolve(channel: RuntimeChannel, currentVersion: string): Promise<ResolvedRuntimeRelease | null>
}

export class RegistryClient implements RuntimeRegistry {
  readonly #fetch: typeof fetch

  constructor(fetchImpl: typeof fetch = fetch) {
    this.#fetch = fetchImpl
  }

  async resolve(
    channel: RuntimeChannel,
    currentVersion: string,
  ): Promise<ResolvedRuntimeRelease | null> {
    assertSemanticVersion(currentVersion)
    const response = await this.#fetch(registryUrl, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) {
      throw new Error(`official Harness registry returned HTTP ${response.status}`)
    }
    const serialized = await response.text()
    if (Buffer.byteLength(serialized, 'utf8') > maxRegistryResponseBytes) {
      throw new Error('official Harness registry response exceeds the size limit')
    }
    const metadata = requireRecord(JSON.parse(serialized) as unknown, 'registry metadata')
    if (metadata.name !== packageName) {
      throw new Error('registry metadata package identity mismatch')
    }
    const versions = requireRecord(metadata.versions, 'registry versions')
    const candidates: ResolvedRuntimeRelease[] = []
    for (const [version, rawEntry] of Object.entries(versions)) {
      try {
        assertSemanticVersion(version)
      } catch {
        continue
      }
      if (compareSemanticVersions(version, currentVersion) <= 0) continue
      // LDD 0.2 ships an extension compiled against the 0.1.x Harness service
      // contracts. A new Harness major/minor line requires a new LDD release
      // (and its matching plugin) instead of an optimistic in-place update.
      if (compareSemanticVersions(version, firstUnsupportedHarnessVersion) >= 0) continue
      if (channel === 'stable' && isPrereleaseVersion(version)) continue
      candidates.push(parseRelease(version, rawEntry, metadata['dist-tags']))
    }
    candidates.sort((left, right) => compareSemanticVersions(right.version, left.version))
    return candidates[0] ?? null
  }
}

function parseRelease(
  version: string,
  rawEntry: unknown,
  rawTags: unknown,
): ResolvedRuntimeRelease {
  const entry = requireRecord(rawEntry, `registry version ${version}`)
  if (entry.name !== packageName || entry.version !== version) {
    throw new Error(`registry version identity mismatch: ${version}`)
  }
  const dist = requireRecord(entry.dist, `registry dist ${version}`)
  if (typeof dist.integrity !== 'string' || !integrityPattern.test(dist.integrity)) {
    throw new Error(`registry version has invalid integrity: ${version}`)
  }
  if (typeof dist.tarball !== 'string') {
    throw new Error(`registry version has no tarball: ${version}`)
  }
  const tarball = new URL(dist.tarball)
  if (
    tarball.protocol !== 'https:' ||
    tarball.origin !== 'https://registry.npmjs.org' ||
    !tarball.pathname.startsWith('/@deepseek-ai/dsh/-/dsh-') ||
    tarball.username.length > 0 ||
    tarball.password.length > 0
  ) {
    throw new Error(`registry version has an untrusted tarball URL: ${version}`)
  }
  return {
    version,
    integrity: dist.integrity,
    tarballUrl: tarball.href,
    releaseTag: resolveReleaseTag(rawTags, version),
  }
}

function resolveReleaseTag(rawTags: unknown, version: string): string {
  const tags = requireRecord(rawTags, 'registry dist-tags')
  const matches = Object.entries(tags)
    .filter(([, taggedVersion]) => taggedVersion === version)
    .map(([tag]) => tag)
  for (const preferred of ['next', 'latest']) {
    if (matches.includes(preferred)) return preferred
  }
  return matches.sort()[0] ?? 'exact-version'
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`)
  }
  return value as Record<string, unknown>
}
