/**
 * The optional plugins offered for one-click install on first boot.
 *
 * Each entry is resolved by the Harness's own plugin command
 * (`dsh plugin --profile web add <spec>`), so the spec is whatever pnpm accepts:
 * an npm package name (optionally pinned with `@version`), a `git+https://…` URL
 * (optionally pinned with `#commit`), or a tarball URL.
 *
 * `bundleName` is the package's own `name` field — it is what the Harness writes
 * into `dsh.profile.bundles` after install, and therefore what the client shows
 * in 设置 → 插件 (and what marks the plugin as enabled by default).
 */
export interface PresetPlugin {
  /** Stable id used for the dismissed-marker file (never shown to the user). */
  readonly id: string
  /** Human-readable label shown in the install prompt. */
  readonly label: string
  /** pnpm install spec (npm name / git URL / tarball URL). */
  readonly spec: string
  /** Package name recorded in `dsh.profile.bundles` after a successful install. */
  readonly bundleName: string
}

export const PRESET_PLUGINS: readonly PresetPlugin[] = [
  {
    id: 'windows-mcp',
    label: 'Windows MCP',
    spec: 'dsh-windows-mcp@0.1.0',
    bundleName: 'dsh-windows-mcp',
  },
  {
    id: 'xiaomi-tts',
    label: '小米 Mimo TTS',
    spec: 'dsh-xiaomi-tts@4.1.0',
    bundleName: 'dsh-xiaomi-tts',
  },
  {
    id: 'agent-teams',
    label: 'Agent Teams',
    spec: '@nanmicoder/dsh-agent-teams@0.1.25',
    bundleName: '@nanmicoder/dsh-agent-teams',
  },
  {
    id: 'hindsight',
    label: 'Hindsight 编码代理',
    spec: '@vectorize-io/hindsight-coding-agents@0.8.2',
    bundleName: '@vectorize-io/hindsight-coding-agents',
  },
  {
    id: 'canvas',
    label: '画布',
    spec: 'git+https://github.com/lb-aigc/dsh-canvas.git#0de995eac2bafc26d634d434f53c6cc6492fc491',
    bundleName: '@ldd/dsh-canvas',
  },
]
