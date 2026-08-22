const identityPath = '/__ldd/identity'
const loopbackHosts = new Set(['127.0.0.1', '[::1]', '::1'])

export interface HarnessIdentity {
  readonly product: 'LDD-Harness'
  readonly nonce: string
  readonly pid: number
}

export interface IdentityProbeOptions {
  readonly expectedPid?: number
  readonly timeoutMs?: number
  readonly fetch?: typeof fetch
}

export async function probeHarnessIdentity(
  baseUrl: string,
  expectedNonce: string,
  options: IdentityProbeOptions = {},
): Promise<HarnessIdentity> {
  const url = new URL(baseUrl)
  if (
    url.protocol !== 'http:' ||
    !loopbackHosts.has(url.hostname) ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    throw new Error('Harness identity probes are restricted to unauthenticated loopback HTTP')
  }
  if (expectedNonce.length < 8 || expectedNonce.length > 256) {
    throw new TypeError('Harness identity nonce length is invalid')
  }

  const requestUrl = new URL(identityPath, url)
  const fetchImpl = options.fetch ?? fetch
  const response = await fetchImpl(requestUrl, {
    cache: 'no-store',
    headers: { accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(options.timeoutMs ?? 1_500),
  })
  if (!response.ok) {
    throw new Error(`Harness identity endpoint returned HTTP ${response.status}`)
  }
  const serialized = await response.text()
  if (serialized.length > 8_192) {
    throw new Error('Harness identity response exceeds the size limit')
  }
  const value = JSON.parse(serialized) as unknown
  if (!isRecord(value)) {
    throw new Error('Harness identity response is not an object')
  }
  if (
    value.product !== 'LDD-Harness' ||
    value.nonce !== expectedNonce ||
    !Number.isSafeInteger(value.pid) ||
    (value.pid as number) <= 0 ||
    (options.expectedPid !== undefined && value.pid !== options.expectedPid)
  ) {
    throw new Error('Harness identity response does not match the LDD-owned process')
  }
  return { product: 'LDD-Harness', nonce: expectedNonce, pid: value.pid as number }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
