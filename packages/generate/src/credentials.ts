/**
 * Secret resolution seam.
 *
 * `settings.apiKeyEnv` stores a *reference* (an environment-variable name or a
 * credentials-domain key), never the secret itself — the settings file is a
 * plain YAML doc and must not carry API keys. A {@link SecretResolver} turns the
 * reference into the real key at request time.
 *
 * The default resolver reads `process.env`. When the settings card ships, its
 * API-key field will write into the Harness credentials domain under the same
 * reference, and a credentials-backed resolver replaces this one — the adapters
 * and tools don't change.
 */
export type SecretResolver = (reference?: string) => string | undefined

/** Resolve a secret reference from the process environment. */
export const environmentSecretResolver: SecretResolver = (reference) =>
  reference === undefined || reference === '' ? undefined : process.env[reference]
