const semanticVersionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const sha256Pattern = /^[a-f0-9]{64}$/
const npmIntegrityPattern = /^sha512-[A-Za-z0-9+/]+={0,2}$/
const driveLetterPattern = /^[A-Za-z]:/
const windowsDeviceStemPattern = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i
const controlCharacterPattern = /[\u0000-\u001f\u007f]/
const invalidWindowsCharacterPattern = /[<>"|?*]/

export interface RuntimeManifestFile {
  readonly path: string
  readonly size: number
  readonly sha256: string
}

export interface RuntimeManifestPlugin {
  readonly name: string
  readonly version: string
  readonly sha256: string
}

export interface RuntimeManifestSignature {
  readonly algorithm: 'ed25519'
  readonly keyId: string
  readonly value: string
}

export interface RuntimeManifest {
  readonly formatVersion: 1
  readonly harnessVersion: string
  readonly platform: 'win32'
  readonly arch: 'x64'
  readonly nodeMajor: 24
  readonly createdAt: string
  readonly minimumLddVersion: string
  readonly sourceArchiveSha256: string
  readonly npmIntegrity: string | null
  readonly signature?: RuntimeManifestSignature
  readonly plugins: readonly RuntimeManifestPlugin[]
  readonly files: readonly RuntimeManifestFile[]
}

export function parseRuntimeManifest(value: unknown): RuntimeManifest {
  const record = requireRecord(value, 'runtime manifest')
  assertExactKeys(record, 'runtime manifest', [
    'formatVersion', 'harnessVersion', 'platform', 'arch', 'nodeMajor', 'createdAt',
    'minimumLddVersion', 'sourceArchiveSha256', 'npmIntegrity', 'signature', 'plugins', 'files',
  ])
  if (record.formatVersion !== 1) throw new TypeError('formatVersion must be 1')
  if (record.platform !== 'win32') throw new TypeError('platform must be win32')
  if (record.arch !== 'x64') throw new TypeError('arch must be x64')
  if (record.nodeMajor !== 24) throw new TypeError('nodeMajor must be 24')
  const plugins = requireArray(record.plugins, 'plugins').map(parsePlugin)
  const files = requireArray(record.files, 'files').map(parseFile)
  if (files.length === 0) throw new TypeError('files must contain at least one runtime file')
  assertSortedUniquePlugins(plugins)
  assertSortedUniqueFiles(files)
  const signature = record.signature === undefined ? undefined : parseSignature(record.signature)
  return {
    formatVersion: 1,
    harnessVersion: requireSemanticVersion(record.harnessVersion, 'harnessVersion'),
    platform: 'win32',
    arch: 'x64',
    nodeMajor: 24,
    createdAt: requireIsoTimestamp(record.createdAt, 'createdAt'),
    minimumLddVersion: requireSemanticVersion(record.minimumLddVersion, 'minimumLddVersion'),
    sourceArchiveSha256: requireSha256(record.sourceArchiveSha256, 'sourceArchiveSha256'),
    npmIntegrity: parseNpmIntegrity(record.npmIntegrity),
    ...(signature === undefined ? {} : { signature }),
    plugins,
    files,
  }
}

export function validateRuntimePath(input: string): string {
  if (
    input.length === 0 || input.length > 240 || input.startsWith('/') || input.startsWith('\\') ||
    driveLetterPattern.test(input) || input.includes('\\') || input.includes(':') ||
    controlCharacterPattern.test(input) || invalidWindowsCharacterPattern.test(input)
  ) throw new Error(`unsafe runtime path: ${JSON.stringify(input)}`)
  const segments = input.split('/')
  if (segments.some((segment) =>
    segment.length === 0 || segment === '.' || segment === '..' || segment.endsWith('.') ||
    segment.endsWith(' ') || windowsDeviceStemPattern.test(segment.split('.', 1)[0]?.trimEnd() ?? ''),
  )) throw new Error(`unsafe runtime path: ${JSON.stringify(input)}`)
  return segments.join('/')
}

export function runtimePathIdentity(input: string): string {
  return validateRuntimePath(input).normalize('NFC').toLowerCase()
}

/** Locale-independent UTF-8 byte ordering for manifests and archives. */
export function compareRuntimeNames(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
}

function parseFile(value: unknown, index: number): RuntimeManifestFile {
  const record = requireRecord(value, `files[${index}]`)
  assertExactKeys(record, `files[${index}]`, ['path', 'size', 'sha256'])
  if (typeof record.path !== 'string') throw new TypeError(`files[${index}].path must be a string`)
  if (!Number.isSafeInteger(record.size) || (record.size as number) < 0) {
    throw new TypeError(`files[${index}].size must be a non-negative safe integer`)
  }
  return {
    path: validateRuntimePath(record.path),
    size: record.size as number,
    sha256: requireSha256(record.sha256, `files[${index}].sha256`),
  }
}

function parsePlugin(value: unknown, index: number): RuntimeManifestPlugin {
  const record = requireRecord(value, `plugins[${index}]`)
  assertExactKeys(record, `plugins[${index}]`, ['name', 'version', 'sha256'])
  if (typeof record.name !== 'string' || !/^@ldd\/[a-z0-9-]+$/.test(record.name)) {
    throw new TypeError(`plugins[${index}].name must be an @ldd package name`)
  }
  return {
    name: record.name,
    version: requireSemanticVersion(record.version, `plugins[${index}].version`),
    sha256: requireSha256(record.sha256, `plugins[${index}].sha256`),
  }
}

function parseSignature(value: unknown): RuntimeManifestSignature {
  const record = requireRecord(value, 'signature')
  assertExactKeys(record, 'signature', ['algorithm', 'keyId', 'value'])
  if (record.algorithm !== 'ed25519') throw new TypeError('signature.algorithm must be ed25519')
  if (typeof record.keyId !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(record.keyId)) {
    throw new TypeError('signature.keyId is invalid')
  }
  if (typeof record.value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(record.value)) {
    throw new TypeError('signature.value must be base64')
  }
  return { algorithm: 'ed25519', keyId: record.keyId, value: record.value }
}

function assertSortedUniqueFiles(files: readonly RuntimeManifestFile[]): void {
  let previous: string | undefined
  const identities = new Set<string>()
  for (const file of files) {
    const identity = runtimePathIdentity(file.path)
    if (identities.has(identity)) throw new TypeError(`duplicate runtime path: ${file.path}`)
    if (previous !== undefined && compareRuntimeNames(previous, file.path) >= 0) {
      throw new TypeError('runtime manifest files must be strictly path-sorted')
    }
    identities.add(identity)
    previous = file.path
  }
}

function assertSortedUniquePlugins(plugins: readonly RuntimeManifestPlugin[]): void {
  let previous: string | undefined
  for (const plugin of plugins) {
    if (previous !== undefined && compareRuntimeNames(previous, plugin.name) >= 0) {
      throw new TypeError('runtime manifest plugins must be strictly name-sorted')
    }
    previous = plugin.name
  }
}

function parseNpmIntegrity(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || !npmIntegrityPattern.test(value)) {
    throw new TypeError('npmIntegrity must be sha512 SRI or null')
  }
  return value
}

function requireSemanticVersion(value: unknown, field: string): string {
  if (typeof value !== 'string' || !semanticVersionPattern.test(value)) {
    throw new TypeError(`${field} must be a semantic version`)
  }
  return value
}

function requireIsoTimestamp(value: unknown, field: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new TypeError(`${field} must be an ISO timestamp`)
  }
  return value
}

function requireSha256(value: unknown, field: string): string {
  if (typeof value !== 'string' || !sha256Pattern.test(value)) {
    throw new TypeError(`${field} must be a lowercase SHA-256 digest`)
  }
  return value
}

function requireArray(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an array`)
  return value
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`)
  }
  return value as Record<string, unknown>
}

function assertExactKeys(record: Record<string, unknown>, field: string, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed)
  for (const key of Object.keys(record)) {
    if (!allowedSet.has(key)) throw new TypeError(`${field} contains unexpected field ${key}`)
  }
}
