import type { RuntimeProgressEvent } from '../../main/ipc/contracts.ts'

export interface RuntimeProgressProps {
  readonly progress: RuntimeProgressEvent | null
}

export function RuntimeProgress({ progress }: RuntimeProgressProps) {
  if (progress === null) return null
  const value = progress.percent ?? undefined
  return (
    <section className="progress-card" aria-live="polite" aria-label="内核更新进度">
      <div className="progress-row">
        <strong>{progress.phase}</strong>
        <span>{value === undefined ? '处理中' : `${Math.round(value)}%`}</span>
      </div>
      <progress max={100} value={value} aria-label={progress.message} />
      <p>{progress.message}</p>
    </section>
  )
}
