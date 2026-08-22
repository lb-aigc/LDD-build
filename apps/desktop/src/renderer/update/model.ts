export interface UpdateFlow {
  readonly candidateVersion: string | null
  readonly downloadedVersion: string | null
  readonly confirmingActivation: boolean
}

export function createUpdateFlow(candidateVersion: string | null): UpdateFlow {
  return {
    candidateVersion,
    downloadedVersion: null,
    confirmingActivation: false,
  }
}

export function setCandidate(flow: UpdateFlow, candidateVersion: string | null): UpdateFlow {
  if (flow.candidateVersion === candidateVersion) return flow
  return createUpdateFlow(candidateVersion)
}

export function completeDownload(flow: UpdateFlow): UpdateFlow {
  if (flow.candidateVersion === null) {
    throw new Error('no candidate runtime is available to mark as downloaded')
  }
  return {
    ...flow,
    downloadedVersion: flow.candidateVersion,
    confirmingActivation: false,
  }
}

export function requestActivation(flow: UpdateFlow): UpdateFlow {
  assertDownloadedCandidate(flow)
  return { ...flow, confirmingActivation: true }
}

export function cancelActivation(flow: UpdateFlow): UpdateFlow {
  return { ...flow, confirmingActivation: false }
}

export function confirmActivation(flow: UpdateFlow): {
  readonly version: string
  readonly next: UpdateFlow
} {
  if (!flow.confirmingActivation) {
    throw new Error('activation confirmation was not requested')
  }
  const version = assertDownloadedCandidate(flow)
  return {
    version,
    next: { ...flow, confirmingActivation: false },
  }
}

function assertDownloadedCandidate(flow: UpdateFlow): string {
  if (
    flow.candidateVersion === null ||
    flow.downloadedVersion === null ||
    flow.downloadedVersion !== flow.candidateVersion
  ) {
    throw new Error('the exact candidate runtime has not been downloaded')
  }
  return flow.downloadedVersion
}
