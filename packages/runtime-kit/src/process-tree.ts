export interface ProcessTreeController {
  readonly pid: number
  isRunning(): boolean
  signalTree(force: boolean): Promise<void>
  waitForExit(timeoutMs: number): Promise<boolean>
}

export interface ProcessTreeDeadlines {
  readonly graceMs: number
  readonly forceMs: number
}

export async function terminateProcessTree(
  controller: ProcessTreeController & ProcessTreeDeadlines,
): Promise<void> {
  validateController(controller)
  if (!controller.isRunning()) {
    return
  }

  const failures: unknown[] = []
  await controller.signalTree(false).catch((error: unknown) => failures.push(error))
  if (await controller.waitForExit(controller.graceMs)) {
    return
  }

  await controller.signalTree(true).catch((error: unknown) => failures.push(error))
  if (await controller.waitForExit(controller.forceMs)) {
    return
  }

  throw new AggregateError(
    failures,
    `process tree ${controller.pid} did not become quiescent after forced termination`,
  )
}

function validateController(controller: ProcessTreeController & ProcessTreeDeadlines): void {
  if (!Number.isSafeInteger(controller.pid) || controller.pid <= 0) {
    throw new TypeError('process-tree pid must be a positive integer')
  }
  for (const [field, value] of [
    ['graceMs', controller.graceMs],
    ['forceMs', controller.forceMs],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(`${field} must be a non-negative integer`)
    }
  }
}
