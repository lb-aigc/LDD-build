/**
 * @ldd/dsh-generate — background generation scheduler.
 *
 * This is the heart of "并发提交、互不阻塞": the `generate_image` tool submits
 * a KIE task and returns its taskId IMMEDIATELY (the agent's turn ends and it is
 * free to take the next request), while this scheduler polls every in-flight
 * task ONCE per tick (non-blocking) and, on completion, downloads the images,
 * stores them as attachments, and fills the pending "生成中…" placeholder node on
 * the canvas — all through the SAME `canvas/state` session event the canvas
 * plugin projects. On failure/timeout it marks the placeholder failed.
 *
 * Lifecycle: started lazily on the first submit, self-stops when the queue
 * drains, and is disposed via `ctx.effect` when the plugin unmounts. Tasks are
 * in-memory only (a restart loses the scheduler's handle, but the KIE taskId is
 * still recoverable server-side; not persisted in the MVP).
 */
import type { AsyncGenerationProvider } from './provider.ts'
import type { AsyncImageTask, GenerateImageResult } from './types.ts'
import { attachImageFromUrl } from './attach.ts'
import type { AttachmentStoreLike } from './attach.ts'
import { foldCanvas, findPendingNodeByTaskId, updateNode } from './canvas-bridge.ts'
import type { SessionStoreLike } from './canvas-bridge.ts'

/** Poll cadence (ms). Matches KIE's sync poll interval. */
const TICK_MS = 3000
/** Per-task poll ceiling: 200 × 3s = 10 min, the same cap the sync path uses. */
const MAX_TASK_POLLS = 200
/** One poll's own timeout (a hung recordInfo must not stall the whole tick). */
const PER_POLL_TIMEOUT_MS = 15000
/** Per-image download+attach timeout. */
const ATTACH_TIMEOUT_MS = 60000

interface ImageTask {
  taskId: string
  sessionId: string
  provider: AsyncGenerationProvider
  asyncTask: AsyncImageTask
  polls: number
}

export class GenerationScheduler {
  private readonly tasks = new Map<string, ImageTask>()
  private timer: ReturnType<typeof setInterval> | undefined
  private disposed = false

  constructor(
    private readonly sessions: () => SessionStoreLike | undefined,
    private readonly attachments: () => AttachmentStoreLike | undefined,
  ) {}

  /** Register a submitted image task and start the poll loop (idempotent). */
  submit(sessionId: string, provider: AsyncGenerationProvider, asyncTask: AsyncImageTask): void {
    this.tasks.set(asyncTask.taskId, { taskId: asyncTask.taskId, sessionId, provider, asyncTask, polls: 0 })
    this.start()
  }

  dispose(): void {
    this.disposed = true
    if (this.timer !== undefined) {
      clearInterval(this.timer)
      this.timer = undefined
    }
    this.tasks.clear()
  }

  private start(): void {
    if (this.timer !== undefined || this.disposed) return
    this.timer = setInterval(() => { void this.tick() }, TICK_MS)
  }

  private async tick(): Promise<void> {
    if (this.disposed) return
    for (const task of [...this.tasks.values()]) {
      if (this.disposed) return
      task.polls += 1
      try {
        const signal = AbortSignal.timeout(PER_POLL_TIMEOUT_MS)
        const result = await task.provider.pollImageOnce(task.asyncTask, signal)
        if (result !== undefined) {
          await this.complete(task, result)
          this.tasks.delete(task.taskId)
          continue
        }
        if (task.polls >= MAX_TASK_POLLS) {
          await this.fail(task, `生成超时（已轮询 ${MAX_TASK_POLLS} 次 / 10 分钟）`)
          this.tasks.delete(task.taskId)
        }
      } catch (error) {
        await this.fail(task, error instanceof Error ? error.message : String(error))
        this.tasks.delete(task.taskId)
      }
    }
    if (this.tasks.size === 0 && this.timer !== undefined) {
      clearInterval(this.timer)
      this.timer = undefined
    }
  }

  /** Completion: download → store → fill the pending placeholder node. */
  private async complete(task: ImageTask, result: GenerateImageResult): Promise<void> {
    const session = this.sessions()?.get(task.sessionId)
    if (session === undefined) return // session closed/deleted — drop silently
    try {
      const before = foldCanvas(session.snapshotEvents())
      const placeholder = findPendingNodeByTaskId(before, task.taskId)
      // The user deleted the placeholder mid-generation — honour that delete
      // (never resurrect a removed card).
      if (placeholder === undefined) return
      const store = this.attachments()
      const first = result.images[0]
      if (first === undefined) return
      const primary = store !== undefined
        ? await attachImageFromUrl(first.url, store, AbortSignal.timeout(ATTACH_TIMEOUT_MS))
        : undefined
      // Extra images (count > 1) become variants of the same node. The primary
      // variant mirrors the first stored attachment.
      const variants = result.images.map((img, index) => ({
        attachmentId: index === 0 ? (primary?.attachmentId ?? img.url) : img.url,
        ...(img.width === undefined ? {} : { width: img.width }),
        ...(img.height === undefined ? {} : { height: img.height }),
      }))
      const next = updateNode(before, placeholder.id, {
        label: '生成图片',
        url: primary?.attachmentId ?? first.url,
        ...(variants.length > 1 ? { variants } : {}),
        meta: {
          ...(primary !== undefined
            ? { width: primary.width, height: primary.height, mediaType: primary.mediaType, bytes: primary.bytes }
            : { width: first.width, height: first.height }),
        },
      })
      session.append('canvas/state', { state: next })
    } catch (error) {
      console.error('[ldd-generate] scheduler complete failed:', error)
    }
  }

  /** Terminal failure: mark the placeholder failed so it does not spin forever. */
  private async fail(task: ImageTask, message: string): Promise<void> {
    const session = this.sessions()?.get(task.sessionId)
    if (session === undefined) return
    try {
      const before = foldCanvas(session.snapshotEvents())
      const placeholder = findPendingNodeByTaskId(before, task.taskId)
      if (placeholder === undefined) return
      const next = updateNode(before, placeholder.id, {
        label: '生成失败',
        meta: { ...(placeholder.meta ?? {}), pending: false, failed: true, error: message },
      })
      session.append('canvas/state', { state: next })
    } catch (error) {
      console.error('[ldd-generate] scheduler fail failed:', error)
    }
  }
}
