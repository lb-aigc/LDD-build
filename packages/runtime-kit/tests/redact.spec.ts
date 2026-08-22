import { describe, expect, it } from 'vitest'
import { redactDiagnostic } from '../src/redact.js'

describe('redactDiagnostic', () => {
  it('removes headers, assignments, JSON secrets, URLs, and credential contents', () => {
    const secret = 'sk-secret-value-123456'
    const redacted = redactDiagnostic(
      [
        `DEEPSEEK_API_KEY=${secret}`,
        `Authorization: Bearer ${secret}`,
        `Cookie: session=${secret}`,
        `{"apiKey":"${secret}"}`,
        `https://example.test/?token=${secret}`,
        `credential-file=${secret}`,
      ].join('\n'),
      [secret],
    )

    expect(redacted).not.toContain(secret)
    expect(redacted).toContain('[REDACTED]')
  })
})
