// Shared platform tags for the runtime host + release artifacts.
//
// The Windows build targets win32/x64, the macOS build targets darwin/arm64.
// Everything else (node/pnpm/ffmpeg source selection, the .lddruntime archive
// name, the installer name) keys off these two helper functions so the three
// release scripts (build-harness-runtime, collect-release-artifacts,
// write-release-checksums) and prepare-runtime-host never drift from each
// other.

export function hostPlatformKey() {
  const key = `${process.platform}-${process.arch}`
  if (key === 'win32-x64' || key === 'darwin-arm64') return key
  throw new Error(`unsupported runtime host platform: ${key}`)
}

export function isWindowsHost() {
  return hostPlatformKey() === 'win32-x64'
}

export function archivePlatformSuffix() {
  return isWindowsHost() ? 'windows-x64' : 'darwin-arm64'
}

export function runtimeArchiveFilename(version) {
  return `deepseek-harness-${version}-${archivePlatformSuffix()}.lddruntime`
}

export function installerFilename(version) {
  return isWindowsHost()
    ? `LDD-Setup-${version}-x64.exe`
    : `LDD-Setup-${version}-arm64.dmg`
}

export function sourceArchiveFilename(version) {
  return `LDD-${version}-source.zip`
}
