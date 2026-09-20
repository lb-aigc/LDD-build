/**
 * Ambient type declaration for the generated `@ldd/dsh-canvas/remote` module.
 *
 * The real module (`lib/typert.remote-client.d.ts` / `.js`) is emitted by the
 * typert generator at build time (build-runtime.ts), so it does NOT exist in
 * the source tree. This ambient declaration lets the source-tree `pnpm -r
 * typecheck` resolve the client half's self-import; at bundle time tsdown
 * resolves the real generated artifact (via the package.json `./remote`
 * export) and inlines it — the ambient declaration is then shadowed by the
 * concrete module and contributes no conflicting symbols.
 */
declare module '@ldd/dsh-canvas/remote' {
  import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
  const contribution: TypertRemoteContribution
  export default contribution
}
