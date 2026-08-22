import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { ManagedMediaChild } from './temp-media.ts'

export interface SubprocessSpawner {
  spawn(spec: SubprocessSpawnSpec): SubprocessHandle
}

export interface ManagedSubprocessOptions {
  readonly maxOutputBytes: number
  readonly graceMs: number
  readonly trackChild?: (child: ManagedMediaChild) => void
}

export async function runManagedSubprocess(
  subprocess: SubprocessSpawner,
  executable: string,
  argv: readonly string[],
  cwd: string,
  signal: AbortSignal,
  options: ManagedSubprocessOptions,
): Promise<{ readonly stdout: string; readonly stderr: string }> {
  signal.throwIfAborted()
  if (!Number.isSafeInteger(options.maxOutputBytes) || options.maxOutputBytes <= 0) {
    throw new TypeError('managed subprocess output limit must be a positive integer')
  }
  if (!Number.isSafeInteger(options.graceMs) || options.graceMs <= 0) {
    throw new TypeError('managed subprocess grace must be a positive integer')
  }
  const handle = subprocess.spawn({
    argv: [executable, ...argv],
    cwd,
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: options.maxOutputBytes },
      stderr: { maxBytes: options.maxOutputBytes },
    },
    graceMs: options.graceMs,
    signal,
  })
  options.trackChild?.({
    stop: async () => { handle.terminate() },
    waitForExit: async () => {
      if (!await handle.waitForExit()) throw new Error('managed media process tree did not exit')
    },
  })
  let outcome: Awaited<typeof handle.done> | undefined
  let primaryError: unknown
  try {
    outcome = await handle.done
  } catch (error) {
    primaryError = error
  }
  // A direct ffmpeg process may close after spawning a helper. Always begin
  // tree termination and wait for full quiescence before callers can remove
  // the task directory.
  handle.terminate()
  let treeError: unknown
  try {
    if (!await handle.waitForExit()) throw new Error('managed media process tree did not exit')
  } catch (error) {
    treeError = error
  }
  if (primaryError !== undefined || treeError !== undefined) {
    const errors = [...(primaryError === undefined ? [] : [primaryError]), ...(treeError === undefined ? [] : [treeError])]
    if (errors.length === 1) throw errors[0]
    throw new AggregateError(errors, 'managed media process and process-tree cleanup failed')
  }
  signal.throwIfAborted()
  const stdout = handle.collected.stdout?.readFrom(0)
  const stderr = handle.collected.stderr?.readFrom(0)
  if (stdout === undefined || stderr === undefined) {
    throw new Error('managed media process did not expose collected output')
  }
  if (stdout.lossy || stderr.lossy) {
    throw new Error('managed media process output exceeded the safety limit')
  }
  if (outcome?.exitCode !== 0) {
    const diagnostic = stderr.text.trim().slice(-4_000)
    throw new Error(
      diagnostic.length === 0
        ? `managed media process exited with code ${String(outcome?.exitCode)} signal ${String(outcome?.signal)}`
        : `managed media process failed: ${diagnostic}`,
    )
  }
  return { stdout: stdout.text, stderr: stderr.text }
}
