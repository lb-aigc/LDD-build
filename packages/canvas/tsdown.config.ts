/**
 * Client bundle for @ldd/dsh-canvas. The node half is built by tsc
 * (lib/index.js); tsdown only emits the browser canvas bundle (lib/client.js)
 * from src/client/index.ts. @xyflow/react is NOT a PLATFORM_MODULE, so it is
 * inlined into lib/client.js (pure JS, no native deps) — the shared
 * clientBundle preset's node-half lib is skipped exactly as in generate.
 */
import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle('@ldd/dsh-canvas', ['lib/index.js'], {
  lib: { entry: '' },
})
