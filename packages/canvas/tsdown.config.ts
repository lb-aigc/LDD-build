/**
 * Client bundle for @ldd/dsh-canvas.
 *
 * The node half (`src/remote.ts`) carries stage-3 `@Remote` decorators. tsc
 * DOES transpile them to `__esDecorate`/`__runInitializers` helpers, but oxc
 * (tsdown's transformer) does NOT — bundling the SOURCE directly would ship
 * raw `@Remote` syntax that Node cannot parse (`SyntaxError: Invalid or
 * unexpected token` → the plugin tree fails to load → the harness kernel
 * crashes on boot).
 *
 * So the node half is bundled from the TSC OUTPUT (`lib/index.js`, already
 * decorator-free), exactly like `session-controller` bundles `lib/types/index.js`.
 * Do NOT add `lib: { entry: '' }` back: with an empty entry tsdown falls back to
 * `src/index.ts` (the raw source) — that fallback is what shipped the boot bug.
 * generate keeps `lib: { entry: '' }` only because it has no decorators.
 *
 * @xyflow/react is NOT a PLATFORM_MODULE, so it is inlined into lib/client.js
 * (pure JS, no native deps).
 */
import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle('@ldd/dsh-canvas', ['lib/index.js'])
