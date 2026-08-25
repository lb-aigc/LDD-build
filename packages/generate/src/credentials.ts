/**
 * Secret resolution seam.
 *
 * `settings.apiKeyEnv` stores a *reference* (an environment-variable name or a
 * credentials-domain key), never the secret itself — the settings file is a
 * plain YAML doc and must not carry API keys. A {@link SecretResolver} turns
 * the reference into the real key at request time.
 *
 * Resolution is ASYNC because the harness credentials service
 * (`ctx.credentials.resolve`) layers the process environment, the
 * provider-managed store (where the settings card's "API Key" field writes via
 * `credentials.set`), and `.env` files. Resolvers are per-call: providers
 * re-resolve on every generation so a changed credential reaches the next
 * operation without a restart.
 */

export type SecretResolver = (reference?: string) => Promise<string | undefined>

/**
 * Default credential reference the settings card uses when `apiKeyEnv` is left
 * blank. Must match the client card's `DEFAULT_API_KEY_REF` (controller.ts)
 * and the reference the card writes through `credentials.set`.
 */
export const DEFAULT_API_KEY_REF = 'GENERATE_API_KEY'

/** Resolve a secret reference from the process environment only. */
export const environmentSecretResolver: SecretResolver = async (reference) =>
  reference === undefined || reference === '' ? undefined : process.env[reference]

/**
 * Minimal surface of the harness credentials service this plugin consumes. A
 * local type shim keeps the lockfile free of a `@deepseek-ai/dsh-credentials`
 * resolution (see the lockfile deadlock note); the runtime service is unchanged.
 */
export interface CredentialsResolveLike {
  resolve(reference: string): Promise<{ value: string } | undefined>
}

/**
 * Resolver that prefers the harness credentials service (env + store + .env),
 * falling back to `process.env` when no credentials service is available. This
 * is what makes the settings card's "API Key" field (written to the
 * credentials store) actually reach the provider.
 */
export function credentialsServiceResolver(credentials: CredentialsResolveLike): SecretResolver {
  return async (reference) => {
    if (reference === undefined || reference === '') return undefined
    const resolved = await credentials.resolve(reference)
    if (resolved !== undefined && resolved.value !== '') return resolved.value
    return process.env[reference]
  }
}
