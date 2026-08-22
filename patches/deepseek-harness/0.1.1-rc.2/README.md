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

The runtime builder applies this patch only to its copied official source tree.
It fails closed when the expected source context changes or the patch was
already applied. Remove it once Harness provides a supported downstream event
registration API.
