export type ImageAdmissionMode = 'standard' | 'large'

export interface HarnessRuntime {
  readonly version: string
  readonly rootPath: string
  readonly nodePath: string
  readonly dshEntryPath: string
  readonly pnpmPath: string
  readonly ffmpegPath: string
  readonly ffprobePath: string
}

export interface HarnessStartOptions {
  readonly dshHome: string
  readonly imageMode: ImageAdmissionMode
  readonly managedPatchPath: string
  readonly preferredPort: number
  readonly startupTimeoutMs: number
  readonly stopGraceMs: number
  readonly forceStopMs: number
  readonly environment: Readonly<Record<string, string | undefined>>
  readonly credentialContents?: readonly string[]
  readonly onDiagnostic: (line: string) => void
}

export interface HarnessHandle {
  readonly pid: number
  readonly port: number
  readonly url: string
  readonly runtimeVersion: string
  readonly ready: Promise<void>
  stop(): Promise<void>
}
