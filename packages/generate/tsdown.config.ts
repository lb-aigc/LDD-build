/**
 * Client bundle for @ldd/dsh-generate. The node half is built by tsc
 * (lib/index.js); tsdown only emits the browser card bundle (lib/client.js)
 * from src/client/index.ts, so the shared clientBundle preset's node-half lib
 * is skipped. This config is only loaded inside the copied Harness tree, where
 * the relative path to the shared preset resolves.
 */
import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle('@ldd/dsh-generate', ['lib/index.js'], {
  lib: { entry: '' },
})
