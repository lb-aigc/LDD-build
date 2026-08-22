export interface ExitState {
  exiting: boolean
}

export interface CompleteExitActions {
  disposeUpdater(): Promise<void>
  stopHarness(): Promise<void>
  quit(): void | Promise<void>
}

export interface PreventableCloseEvent {
  preventDefault(): void
}

export async function completeExit(actions: CompleteExitActions): Promise<void> {
  const errors: unknown[] = []
  await actions.disposeUpdater().catch((error: unknown) => errors.push(error))
  await actions.stopHarness().catch((error: unknown) => errors.push(error))
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) throw new AggregateError(errors, 'desktop shutdown did not reach quiescence')
  await actions.quit()
}

export function createCompleteExit(
  state: ExitState,
  actions: CompleteExitActions,
): () => Promise<void> {
  let pending: Promise<void> | null = null
  return () => {
    pending ??= (async () => {
      state.exiting = true
      try {
        await completeExit(actions)
      } catch (error) {
        state.exiting = false
        pending = null
        throw error
      }
    })()
    return pending
  }
}

export function createWindowCloseHandler(
  state: Readonly<ExitState>,
  hide: () => void,
): (event: PreventableCloseEvent) => void {
  return (event) => {
    if (state.exiting) return
    event.preventDefault()
    hide()
  }
}
