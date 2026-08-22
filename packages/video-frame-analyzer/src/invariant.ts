import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type {} from './types.ts'
import { validateVideoAnalysisInputRecord } from './record-validation.ts'

const packageName = '@ldd/dsh-video-frame-analyzer'

export const name = 'ldd-video-frame-analyzer-invariant'
export const inject = ['invariants']

interface AnalysisTrace {
  readonly provider: string
  readonly model: string
  nextBatchIndex: number
}

type VideoTrace = Map<string, AnalysisTrace>

function isAnalysisInput(event: SessionEvent): boolean {
  return event.type === 'video/analysis-input'
}

function applyEvent(trace: VideoTrace, event: SessionEvent, fail: InvariantFailure): void {
  const { analysisId, batchIndex, provider, model } = validateVideoAnalysisInputRecord(
    event.data,
    (message) => fail(message),
  )

  const existing = trace.get(analysisId)
  if (existing === undefined) {
    if (batchIndex !== 0) fail('the first video/analysis-input batchIndex must be 0')
    trace.set(analysisId, { provider, model, nextBatchIndex: 1 })
    return
  }
  if (existing.provider !== provider || existing.model !== model) {
    fail('one video analysis cannot change its provider/model route between batches')
  }
  if (batchIndex !== existing.nextBatchIndex) {
    fail(`video/analysis-input batchIndex must be ${existing.nextBatchIndex}`)
  }
  existing.nextBatchIndex += 1
}

const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const traces = new WeakMap<Session, VideoTrace>()
  const staged = new WeakMap<SessionEvent, { readonly session: Session; readonly trace: VideoTrace }>()
  const seed = (session: Session): VideoTrace => {
    const trace: VideoTrace = new Map()
    for (const event of session.events.filter(isAnalysisInput)) applyEvent(trace, event, fail)
    traces.set(session, trace)
    return trace
  }
  ctx.sessions.list().forEach(seed)
  ctx.on('session/created', (session) => { seed(session) }, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    if (!isAnalysisInput(event)) return
    const previous = traces.get(session)
    if (previous === undefined) fail('video analysis Session was not seeded')
    const trace = cloneTrace(previous)
    applyEvent(trace, event, fail)
    staged.set(event, { session, trace })
  }, { global: true })
  ctx.on('session/event', (session, event) => {
    if (!isAnalysisInput(event)) return
    const candidate = staged.get(event)
    if (candidate === undefined || candidate.session !== session) {
      fail('video/analysis-input reached publication without validation')
    }
    staged.delete(event)
    traces.set(session, candidate.trace)
  }, { global: true })
}, { inject: ['sessions'] })

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(packageName, install))

function cloneTrace(source: VideoTrace): VideoTrace {
  return new Map([...source].map(([id, value]) => [id, { ...value }]))
}
