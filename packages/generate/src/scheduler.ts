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
import type { AsyncImageTask, GeneratedImage, GenerateImageResult } from './types.ts'
import { attachImageFromUrl, imageBlockOf } from './attach.ts'
import type { AttachmentStoreLike, ImageMeta } from './attach.ts'
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
      // Download & store EVERY image (not just the first) so each variant carries
      // a durable attachmentId — otherwise variant i>0 kept the temporary R2 URL
      // (which expires in ~20 min, the same broken-image class the text-block fix
      // addressed). The first image is the primary/surface variant.
      const stored: Array<{ img: GeneratedImage; meta: ImageMeta | undefined }> = []
      for (const img of result.images) {
        const meta = store !== undefined
          ? await attachImageFromUrl(img.url, store, AbortSignal.timeout(ATTACH_TIMEOUT_MS))
          : undefined
        stored.push({ img, meta })
      }
      const primary = stored[0]
      if (primary === undefined) return
      const primaryMeta = primary.meta
      const variants = stored.map(({ img, meta }) => ({
        attachmentId: meta?.attachmentId ?? img.url,
        ...(meta?.mediaType === undefined ? {} : { mediaType: meta.mediaType }),
        ...(meta?.bytes === undefined ? {} : { bytes: meta.bytes }),
        ...(meta?.width === undefined ? (img.width === undefined ? {} : { width: img.width }) : { width: meta.width }),
        ...(meta?.height === undefined ? (img.height === undefined ? {} : { height: img.height }) : { height: meta.height }),
      }))
      const next = updateNode(before, placeholder.id, {
        label: '生成图片',
        url: primaryMeta?.attachmentId ?? first.url,
        ...(variants.length > 1 ? { variants } : {}),
        meta: {
          ...(primaryMeta !== undefined
            ? { width: primaryMeta.width, height: primaryMeta.height, mediaType: primaryMeta.mediaType, bytes: primaryMeta.bytes }
            : { width: first.width, height: first.height }),
        },
      })
      session.append('canvas/state', { state: next })

      // 同时把图片追加到会话框：一条 notice 形式的 user 消息，携带图片。
      // user/message 不受 open-step 约束（可跨 turn 追加）、不唤醒 agent，且
      // notice form 会被前端渲染为可见的上下文消息（图片 block 在 user 消息中
      // 内联渲染）。这样生成图既落在画布上，也出现在会话框里。
      const imageBlocks = stored
        .map(({ meta }) => meta)
        .filter((m): m is ImageMeta => m !== undefined)
        .map(imageBlockOf)
      session.append('user/message', {
        id: crypto.randomUUID(),
        role: 'user',
        content: [
          { type: 'text', text: `图片生成完成，共 ${stored.length} 张，已同步到画布。` },
          ...imageBlocks,
        ],
        source: { kind: 'generate', form: 'notice', summary: `图片生成完成（${stored.length} 张）` },
      })
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
