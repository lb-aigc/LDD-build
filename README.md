# LDD 0.2.0

LDD is a Windows desktop shell for DeepSeek Harness. The desktop shell and the Harness runtime have separate release lifecycles: routine Harness updates install into versioned user-data directories, while changes to Electron/UI features are delivered through a new LDD installer.

## 0.2.0 highlights

- Independently install, verify, activate, and roll back the Harness runtime.
- Validate every candidate by actually starting it once with a fresh Profile and once with an isolated copy of the current Profile before touching live data.
- Keep an immutable packaged Harness fallback for recovery.
- Preserve the user profile while switching runtime versions.
- Standard 20 MiB and advanced 64 MiB single-image admission modes, with aggregate, pixel, dimension, normalization, and concurrency bounds retained.
- Bundled `analyze_video` plugin: local FFmpeg probing/frame extraction, bounded JPEG contact sheets, and analysis through an image-capable DeepSeek route.
- Verified migration from the legacy `%USERPROFILE%\.dsh` profile without deleting the original.

Chinese user instructions are in [docs/user/更新内核与回滚.md](docs/user/更新内核与回滚.md).

## Reproducible Windows release

Use Windows x64 with Node 24 and pnpm 11.7.0:

```powershell
pnpm install
pnpm test
pnpm typecheck
pnpm dist:win
```

`pnpm dist:win` verifies and prepares the pinned Node/pnpm/FFmpeg runtime host, builds the approved Harness source snapshot and LDD plugin into the fallback runtime, builds the desktop application, and writes the NSIS installer, `-windows-x64.lddruntime`, `LDD-0.2.0-source.zip`, and `checksums.sha256` below `release/`.

The manual uninstaller keeps all Harness settings, sessions, runtimes, and backups by default. It offers an explicit, default-No confirmation before removing those data directories; internal update uninstalls never show that prompt or delete the data.

The approved source archive is `vendor/sources/deepseek-harness-0.1.1-rc.2.zip` with SHA-256 `47fb7e386c0bd86a6c4341321b8f2915cd6f490a687f8deaf78714e369e4c91d`.
