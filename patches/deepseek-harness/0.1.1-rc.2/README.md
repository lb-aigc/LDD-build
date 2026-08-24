# LDD patches for DeepSeek Harness 0.1.1-rc.2

`0001-register-video-analysis-input-session-event.patch` registers the durable
input record emitted by `@ldd/dsh-video-frame-analyzer`. Harness 0.1.1-rc.2
generates a closed persistence catalog from in-repository declarations and has
no downstream registration surface. Without this compatibility patch, a
session containing `video/analysis-input` can be written but is rejected when
it is reopened.

`0002-launch-package-manager-shims-on-windows.patch` routes the upstream
release helpers' `pnpm`, `npm`, and `npx` calls through `ComSpec` on Windows.
Node 24 rejects direct execution of the `.cmd` shims installed by Corepack, so
the unpatched release pack fails before producing the runtime tarballs.

`0003-rebrand-ldd.patch` replaces the DeepSeek Harness brand surfaces with the
LDD brand: the sidebar/hero brand mark becomes the traced LDD wordmark (an
inline `currentColor` SVG, height-first at a 1031:487 ratio, so it stays legible
in both themes), the sidebar brand name becomes `LDD`, the conversation hero
headline becomes `LDD`, and the hero mark column widens from 34px to 47px while
the fish "swim" hover animation is dropped. The wordmark path is inlined into
`Brand.tsx` because the tracked-patch runner only edits existing files.

`0004-rebrand-ldd-trim.patch` pares the brand back to a single centered wordmark.
It drops the sidebar brand name (keeping only the mark), removes the hero
headline and preview badge, enlarges the hero mark from 22px to 48px tall, turns
the hero headline grid into a centered flex row, and changes the client document
title from `DeepSeek Harness` to `LDD`.

The runtime builder applies this patch only to its copied official source tree.
It fails closed when the expected source context changes or the patch was
already applied. Remove it once Harness provides a supported downstream event
registration API.
