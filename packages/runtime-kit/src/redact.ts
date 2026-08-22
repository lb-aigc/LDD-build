const authorizationPattern = /^(authorization|proxy-authorization)\s*:\s*.*$/gimu
const cookiePattern = /^(cookie|set-cookie)\s*:\s*.*$/gimu
const assignmentPattern =
  /\b([A-Z0-9_]*(?:API[_-]?KEY|ACCESS[_-]?TOKEN|AUTH[_-]?TOKEN|SECRET|PASSWORD))\s*=\s*([^\s;]+)/gimu
const jsonSecretPattern =
  /(["'](?:api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password)["']\s*:\s*["'])([^"'\r\n]+)(["'])/gimu
const urlSecretPattern =
  /([?&](?:api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password)=)[^&#\s]+/gimu
const bearerPattern = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/gimu
const commonApiKeyPattern = /\bsk-[A-Za-z0-9_-]{8,}\b/gu

export function redactDiagnostic(
  input: string,
  credentialContents: readonly string[] = [],
): string {
  let redacted = input
    .replace(authorizationPattern, '$1: [REDACTED]')
    .replace(cookiePattern, '$1: [REDACTED]')
    .replace(assignmentPattern, '$1=[REDACTED]')
    .replace(jsonSecretPattern, '$1[REDACTED]$3')
    .replace(urlSecretPattern, '$1[REDACTED]')
    .replace(bearerPattern, '$1 [REDACTED]')
    .replace(commonApiKeyPattern, '[REDACTED]')

  const uniqueCredentials = [...new Set(credentialContents)]
    .filter((credential) => credential.length > 0)
    .sort((left, right) => right.length - left.length)
  for (const credential of uniqueCredentials) {
    redacted = redacted.split(credential).join('[REDACTED]')
  }
  return redacted
}
