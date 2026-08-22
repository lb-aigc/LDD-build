import { compareSemanticVersions } from './semver.ts'

const firstVisionRuntimeVersion = '0.1.1-rc.1'

export interface HealthRuntime {
  readonly version: string
  readonly path: string
}

export interface CandidateHealthHomes {
  readonly freshHome: string
  readonly profileCopyHome: string
}

export type CandidateHealthPhase =
  | { readonly kind: 'fresh'; readonly dshHome: string }
  | { readonly kind: 'profile-copy'; readonly dshHome: string }

export interface CandidateHealthEvidence {
  readonly boundHost: string
  readonly webRootOk: boolean
  readonly apiManifestOk: boolean
  readonly textModelDeclared: boolean
  readonly visionModelDeclared: boolean
  readonly videoToolRegistered: boolean
  readonly pluginListOk: boolean
  readonly incompatiblePlugins: readonly string[]
}

export interface CandidateHealthProcess {
  inspect(): Promise<CandidateHealthEvidence>
  stop(): Promise<void>
  isQuiescent(): Promise<boolean>
}

export interface CandidateHealthDriver {
  checkCliVersion(runtime: HealthRuntime): Promise<string>
  start(runtime: HealthRuntime, phase: CandidateHealthPhase): Promise<CandidateHealthProcess>
}

export type CandidateHealthResult =
  | { readonly kind: 'healthy' }
  | {
      readonly kind: 'incompatible-plugins'
      readonly incompatiblePlugins: readonly string[]
    }

export async function runTwoPhaseCandidateHealth(
  runtime: HealthRuntime,
  homes: CandidateHealthHomes,
  driver: CandidateHealthDriver,
): Promise<CandidateHealthResult> {
  const reportedVersion = await driver.checkCliVersion(runtime)
  if (reportedVersion !== runtime.version) {
    throw new Error(
      `candidate dsh --version mismatch: expected ${runtime.version}, received ${reportedVersion}`,
    )
  }
  const fresh = await runPhase(runtime, { kind: 'fresh', dshHome: homes.freshHome }, driver)
  assertCoreEvidence(runtime.version, fresh)
  if (fresh.incompatiblePlugins.length > 0) {
    throw new Error('fresh candidate reported incompatible plugins')
  }

  const profileCopy = await runPhase(
    runtime,
    { kind: 'profile-copy', dshHome: homes.profileCopyHome },
    driver,
  )
  assertCoreEvidence(runtime.version, profileCopy)
  const incompatiblePlugins = [...new Set(profileCopy.incompatiblePlugins)].sort()
  return incompatiblePlugins.length === 0
    ? { kind: 'healthy' }
    : { kind: 'incompatible-plugins', incompatiblePlugins }
}

async function runPhase(
  runtime: HealthRuntime,
  phase: CandidateHealthPhase,
  driver: CandidateHealthDriver,
): Promise<CandidateHealthEvidence> {
  const process = await driver.start(runtime, phase)
  let evidence: CandidateHealthEvidence | undefined
  let primaryError: unknown
  try {
    evidence = await process.inspect()
  } catch (error) {
    primaryError = error
  }

  const teardownErrors: unknown[] = []
  await process.stop().catch((error: unknown) => teardownErrors.push(error))
  const quiescent = await process
    .isQuiescent()
    .catch((error: unknown) => {
      teardownErrors.push(error)
      return false
    })
  if (!quiescent) {
    teardownErrors.push(new Error(`${phase.kind} candidate left a child process running`))
  }
  if (primaryError !== undefined || teardownErrors.length > 0) {
    throw new AggregateError(
      [...(primaryError === undefined ? [] : [primaryError]), ...teardownErrors],
      `${phase.kind} candidate health check failed`,
    )
  }
  if (evidence === undefined) {
    throw new Error(`${phase.kind} candidate returned no health evidence`)
  }
  return evidence
}

function assertCoreEvidence(version: string, evidence: CandidateHealthEvidence): void {
  if (evidence.boundHost !== '127.0.0.1') {
    throw new Error('candidate did not bind exclusively to 127.0.0.1')
  }
  for (const [field, passed] of [
    ['web root', evidence.webRootOk],
    ['API startup manifest', evidence.apiManifestOk],
    ['text model catalog', evidence.textModelDeclared],
    ['video tool registration', evidence.videoToolRegistered],
    ['plugin list', evidence.pluginListOk],
  ] as const) {
    if (!passed) throw new Error(`candidate failed ${field} health check`)
  }
  if (
    compareSemanticVersions(version, firstVisionRuntimeVersion) >= 0 &&
    !evidence.visionModelDeclared
  ) {
    throw new Error('candidate does not declare the DeepSeek vision model')
  }
  for (const plugin of evidence.incompatiblePlugins) {
    if (typeof plugin !== 'string' || plugin.length === 0 || plugin.length > 256) {
      throw new Error('candidate reported an invalid incompatible plugin identity')
    }
  }
}
