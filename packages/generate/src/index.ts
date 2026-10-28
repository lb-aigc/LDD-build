import type { Context, Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { readFile } from 'node:fs/promises'

import { imageAspectRatios, imageResolutions, maxImagesPerRequest, maxVideoDurationSeconds, videoAspectRatios, videoResolutions } from './config.ts'
import type { GenerationConfig, ImageAspectRatio, ImageResolution, ImageSize } from './config.ts'
import { credentialsServiceResolver, environmentSecretResolver } from './credentials.ts'
import type { SecretResolver } from './credentials.ts'
import { attachImageFromUrl, imageBlockOf, mediaTypeFromUrl } from './attach.ts'
import type { AttachmentStoreLike, ImageMeta } from './attach.ts'
import { aspectRatioToImageSize, isAsyncProvider } from './provider.ts'
import { collectUploadedImages } from './uploaded-images.ts'
import type { UploadedAgentLike, UploadedImageRef } from './uploaded-images.ts'
import { GenerationScheduler } from './scheduler.ts'
import { addEdge, addNode, foldCanvas, updateNode } from './canvas-bridge.ts'
import type { SessionLike, SessionStoreLike } from './canvas-bridge.ts'
import { IMAGE_PROVIDER_PRESETS, VIDEO_PROVIDER_PRESETS, MUSIC_PROVIDER_PRESETS } from './presets.ts'
import {
  buildProvider,
  modelCatalog,
  modelPickContextText,
  pickProvider,
  resolveModels,
  resolveProvider,
  supportsImageToImage,
} from './routing.ts'
import type { ResolvedModels } from './routing.ts'
import {
  ImageGenerationSettingsSchema,
  VideoGenerationSettingsSchema,
  MusicGenerationSettingsSchema,
} from './settings.ts'
import type { ImageGenerationSettings, VideoGenerationSettings, MusicGenerationSettings } from './settings.ts'

export const name = 'ldd-generate'
export const inject = ['tools', 'commands', 'sessions']

export interface Config extends GenerationConfig {
  /** Image-generation settings (volatile: edited live from the browser). */
  image: Volatile<ImageGenerationSettings | undefined>
  /** Video-generation settings (volatile: edited live from the browser). */
  video: Volatile<VideoGenerationSettings | undefined>
  /** Music-generation settings (volatile: edited live from the browser). */
  music: Volatile<MusicGenerationSettings | undefined>
}

/** Raw input accepted by the Config schema (volatile fields are unwrapped). */
interface ConfigInput {
  timeoutMs?: number | null
  image?: ImageGenerationSettings | null
  video?: VideoGenerationSettings | null
  music?: MusicGenerationSettings | null
}

export const Config: z<ConfigInput, Config> = z.object({
  timeoutMs: z.natural().min(1),
  image: ImageGenerationSettingsSchema.volatile(),
  video: VideoGenerationSettingsSchema.volatile(),
  music: MusicGenerationSettingsSchema.volatile(),
})

const imageResultSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    images: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          index: { type: 'integer', required: true },
          url: { type: 'string', required: true },
          width: { type: 'integer', required: true },
          height: { type: 'integer', required: true },
          prompt: { type: 'string', required: true },
          attachment: {
            type: 'object',
            additionalProperties: false,
            properties: {
              attachmentId: { type: 'string', required: true },
              mediaType: { type: 'string', required: true },
              bytes: { type: 'integer', required: true },
              width: { type: 'integer', required: true },
              height: { type: 'integer', required: true },
              name: { type: 'string' },
            },
          },
        },
      },
    },
    provider: { type: 'string', required: true },
    model: { type: 'string', required: true },
    submitted: { type: 'boolean' },
    taskId: { type: 'string' },
  },
} as const

const videoResultSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    videos: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          index: { type: 'integer', required: true },
          url: { type: 'string', required: true },
          durationSeconds: { type: 'number', required: true },
          resolution: { type: 'string', required: true },
          aspectRatio: { type: 'string', required: true },
          prompt: { type: 'string', required: true },
        },
      },
    },
    provider: { type: 'string', required: true },
    model: { type: 'string', required: true },
  },
} as const

const musicResultSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    music: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          index: { type: 'integer', required: true },
          url: { type: 'string', required: true },
          coverUrl: { type: 'string', required: true },
          title: { type: 'string', required: true },
          durationSeconds: { type: 'number', required: true },
          tags: { type: 'string', required: true },
          modelName: { type: 'string', required: true },
          prompt: { type: 'string', required: true },
          coverAttachment: {
            type: 'object',
            additionalProperties: false,
            properties: {
              attachmentId: { type: 'string', required: true },
              mediaType: { type: 'string', required: true },
              bytes: { type: 'integer', required: true },
              width: { type: 'integer', required: true },
              height: { type: 'integer', required: true },
              name: { type: 'string' },
            },
          },
        },
      },
    },
    provider: { type: 'string', required: true },
    model: { type: 'string', required: true },
  },
} as const

/** Read a local image file path into a `data:` URI. This lets the agent pass a
 *  workspace file path (e.g. `D:\\file\\inputs\\ref.jpg`) directly as a reference
 *  image instead of writing shell scripts to upload it to a relay — the root
 *  cause of the "dozens of pwsh/node calls for one image-to-image" behaviour.
 *  The media type is guessed from the extension; an unreadable path or unknown
 *  extension returns undefined and the entry is dropped from the references. */
async function readLocalImageReference(path: string): Promise<string | undefined> {
  try {
    const mediaType = mediaTypeFromUrl(path)
    if (mediaType === undefined) return undefined
    const bytes = await readFile(path)
    return `data:${mediaType};base64,${Buffer.from(bytes).toString('base64')}`
  } catch {
    return undefined
  }
}

/** A resolved reference image: its data URI plus an optional durable
 *  `attachmentId` (present when the entry came from an uploaded attachment or a
 *  `sha256:` reference; absent for raw URLs / data URIs / local paths). The id
 *  lets the async submit path correlate a reference with a canvas node whose
 *  `url` IS that id, so fan-out (one ref per node) vs merge (many refs → one
 *  node) is driven by the agent's own `inputImages` shape. */
interface ResolvedRef {
  dataUri: string
  attachmentId?: string
}

/** Resolve the `inputImages` tool argument. Each entry is one of:
 *   - `@uploaded` / `@latest`       → ALL user-uploaded images (order preserved)
 *   - `@uploaded[i]` / `@latest[i]` → the i-th uploaded image (0-based; a comma
 *                                     list like `@uploaded[0,2]` selects several)
 *   - `sha256:…`                    → the uploaded image whose attachment id matches
 *   - an http(s) URL / data URI     → passed through as-is
 *   - a local file path             → read into a data URI */
async function resolveReferenceImages(
  inputImages: unknown,
  exec: { agent?: UploadedAgentLike; signal: AbortSignal },
  store: AttachmentStoreLike | undefined,
): Promise<ResolvedRef[]> {
  const raw = Array.isArray(inputImages) ? inputImages.filter((entry): entry is string => typeof entry === 'string') : []
  if (raw.length === 0) return []
  const needsUploaded = raw.some((entry) =>
    entry === '@uploaded' || entry === '@latest'
    || /^@(?:uploaded|latest)\[[\d,\s]*\]$/.test(entry)
    || entry.startsWith('sha256:'))
  const uploaded: UploadedImageRef[] = needsUploaded
    ? await collectUploadedImages(exec.agent?.session, store, exec.signal)
    : []
  const resolved: ResolvedRef[] = []
  for (const entry of raw) {
    // @uploaded / @latest → all uploaded images
    if (entry === '@uploaded' || entry === '@latest') {
      for (const u of uploaded) resolved.push(u)
      continue
    }
    // @uploaded[i] / @uploaded[i,j] → indexed selection
    const indexed = entry.match(/^@(?:uploaded|latest)\[([\d,\s]*)\]$/)
    if (indexed !== null) {
      const indices = (indexed[1] ?? '')
        .split(',')
        .map((s) => Number.parseInt(s.trim(), 10))
        .filter((n) => !Number.isNaN(n))
      for (const i of indices) {
        const u = uploaded[i]
        if (u !== undefined) resolved.push(u)
      }
      continue
    }
    // sha256:… → match by attachment id (the id may already carry the prefix)
    if (entry.startsWith('sha256:')) {
      const found = uploaded.find((u) => u.attachmentId === entry || u.attachmentId === entry.slice('sha256:'.length))
      if (found !== undefined) resolved.push(found)
      continue
    }
    // http(s) URL / data URI → pass through (no durable id)
    if (entry.startsWith('http://') || entry.startsWith('https://') || entry.startsWith('data:')) {
      resolved.push({ dataUri: entry })
      continue
    }
    // local file path → data URI (no durable id)
    const dataUri = await readLocalImageReference(entry)
    if (dataUri !== undefined) resolved.push({ dataUri })
  }
  return resolved
}

/** 当前工具调用所属的会话（结构化 face，避免 import dsh-session 的 Session）。 */
function sessionOf(exec: unknown): SessionLike | undefined {
  return (exec as { agent?: { session?: SessionLike } }).agent?.session
}

function defineImageTool(
  resolved: ResolvedModels,
  config: Config,
  secret: { resolve: SecretResolver },
  attachments: { current?: AttachmentStoreLike },
  sessionOverrides: { get(key: string): string | undefined },
  scheduler: GenerationScheduler,
) {
  const providerKeys = resolved.entries.map((entry) => entry.key)
  return defineTool({
    name: 'generate_image',
    description:
      'Generate one or more images from a text prompt using an image-generation model. Call this when the user asks to create, draw, render, or imagine a picture, illustration, poster, avatar, or any visual asset. Returns image references (URL), dimensions, and the prompt used.\n\n'
      + 'The generated images are shown to the user directly (the tool returns image blocks the UI renders), so you only need to describe the result in words — do not write markdown image syntax.\n\n'
      + 'Available models (pick `provider` by need, or omit to use the default):\n'
      + modelCatalog(resolved, IMAGE_PROVIDER_PRESETS),
    parameters: {
      prompt: { type: 'string', required: true, description: 'The image description. Be concrete and detailed: subject, style, composition, lighting, palette, mood. Rewrite the user intent into a rich visual prompt.' },
      provider: { type: 'string', enum: providerKeys, description: 'Which configured model to use. Match the request to the model whose strengths fit (see the catalog above). If the user has selected a model (see the runtime context), omit this to use the user\'s pick; otherwise omit to use the default model.' },
      count: { type: 'integer', description: 'How many image variants to generate (1-4).' },
      aspectRatio: { type: 'string', enum: [...imageAspectRatios], description: 'Target aspect ratio. Choose from the enum to match the composition: 16:9 and 9:16 for horizontal/vertical widescreen, 1:1 square, 4:3 / 3:4 classic photo, 2:1 / 1:2 cinematic, 4:5 / 5:4 portrait/landscape, 21:9 / 9:21 ultra-wide. Omit to default to 16:9.' },
      resolution: { type: 'string', enum: [...imageResolutions], description: 'Output resolution tier: 4K / 2K / 1K. Always request 4K FIRST; the provider automatically degrades to 2K or 1K only when the chosen aspect ratio does not support the higher tier (1:1 caps at 2K; 4:5 / 5:4 / 9:21 cap at 1K). Omit to default to 4K.' },
      style: { type: 'string', description: 'Optional visual style keyword (e.g. photorealistic, anime, watercolor, cyberpunk).' },
      inputImages: { type: 'array', items: { type: 'string' }, description: 'Reference images for image-to-image editing. Each entry is one of: (a) an http(s) URL, (b) a data URI, (c) a LOCAL FILE PATH to a workspace image (the tool reads the file itself; do NOT write shell scripts to upload it), (d) "@uploaded" for ALL images the user just attached, (e) "@uploaded[i]" (0-based; "@uploaded[0]" = the FIRST uploaded image, "@uploaded[0,2]" = first and third) to reference ONE specific uploaded image, or (f) "sha256:<id>" to reference an uploaded image by attachment id. Put the edit instruction in `prompt`. NEVER write Python/OpenCV/PIL/compositing scripts to mask or erase images by hand — always route through this tool.\n\nMatch the reference count to the user intent: (A) PER-IMAGE output — the user wants a separate result for EACH reference image (e.g. "参考这3张服饰图，每张生成2个角色" = 3 independent groups) → call this tool ONCE PER IMAGE, passing exactly ONE reference each time ("@uploaded[0]", then "@uploaded[1]", then "@uploaded[2]"); (B) FUSED output — the user wants ONE result combining several references as different dimensions (e.g. "用A的款式+B的颜色+C的材质，出一张图") → call ONCE with ALL references together and describe each image\'s role in the prompt. Only providers that support i2i accept it — Midjourney and Legnext reject it.' },
    },
    output: {
      schema: imageResultSchema,
      render: (_args, value) => {
        // Async submit path: the task is running in the background scheduler.
        // Report the submission (not the image) so the agent ends its turn and
        // the user can submit the next request while generation continues.
        if (value.submitted === true) {
          const taskId = (value as { taskId?: string }).taskId ?? ''
          return [{ type: 'text', text: `已提交生图任务（taskId=${taskId}），正在后台生成，完成后图片会自动出现在对话里。` }] as any
        }
        // Emit each image BOTH as an `image` block (the frontend renders it
        // inline via the attachment slot) AND as a text line carrying the URL
        // (the model reads the URL to describe the result). The harness
        // frontend has no image renderer for TOOL RESULTS by default — the
        // image block here is rendered by the LDD 0005 upstream patch, which
        // threads `renderMessageImages` into the tool row. Without that patch
        // the image block degrades to JSON text, so the URL line keeps the
        // result useful to the model either way.
        const blocks: Array<{ type: 'text'; text: string } | { type: 'image'; attachment: ImageMeta }> = []
        for (const image of value.images) {
          if (image.attachment !== undefined) {
            const meta = image.attachment as ImageMeta
            blocks.push(imageBlockOf(meta))
            // The image block already renders the picture inline. The text line
            // is for the MODEL to reference the result — but the provider URL is
            // a TEMPORARY presigned R2 link (X-Amz-Expires=1200, 20 min), so it
            // would be dead by the time the model or a later turn reads it. Emit
            // the PERMANENT content-addressed attachment id instead, which the
            // model can resolve via read_image / the attachment RPC forever.
            blocks.push({ type: 'text', text: `图片 ${image.index}（${image.width}x${image.height}）：${meta.attachmentId}` })
          } else {
            // Download failed / placeholder scheme — no durable attachment, so
            // keep the URL as the only reference (degrades to text, never throws).
            blocks.push({ type: 'text', text: `图片 ${image.index}（${image.width}x${image.height}）：${image.url}` })
          }
        }
        // The image block's `attachment` carries the harness's nominal
        // ImageAttachmentRef brand (compile-time only; a plain string at
        // runtime). This plugin shims the type to avoid a lockfile dependency,
        // so the array is asserted to the tool's ContentBlock[] return type.
        return blocks as any
      },
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      // A user's per-session button pick is enforced: the agent may not
      // silently switch models; it must ask the user first (resolveProvider).
      const sessionId = (exec as unknown as { agent?: { id?: string } }).agent?.id
      const entry = resolveProvider(resolved, args.provider, sessionId, sessionOverrides)
      const references = await resolveReferenceImages(
        args.inputImages,
        exec as unknown as { agent?: UploadedAgentLike; signal: AbortSignal },
        attachments.current,
      )
      if (references.length > 0 && !supportsImageToImage(entry, IMAGE_PROVIDER_PRESETS)) {
        const i2iModels = resolved.entries
          .filter((candidate) => supportsImageToImage(candidate, IMAGE_PROVIDER_PRESETS))
          .map((candidate) => candidate.key)
        const hint = i2iModels.length > 0
          ? `请先向用户说明「${entry.key}」不支持图生图，并询问是否切换到以下任一支持图生图的模型：${i2iModels.join('、')}。获得用户同意后，先调用 set_generation_model 切换模型，再重新调用 generate_image。`
          : '当前没有配置任何支持图生图的模型，请提示用户在设置中配置一个支持图生图的模型。'
        throw new Error(`provider "${entry.key}" 不支持图生图。${hint}`)
      }
      const provider = await buildProvider(entry, IMAGE_PROVIDER_PRESETS, secret.resolve)
      const count = args.count === undefined ? 1 : Math.max(1, Math.min(maxImagesPerRequest, args.count))
      const aspectRatio = (args.aspectRatio ?? '16:9') as ImageAspectRatio
      const resolution = (args.resolution ?? '4K') as ImageResolution
      const request = {
        prompt: args.prompt,
        count,
        size: aspectRatioToImageSize(aspectRatio) as ImageSize,
        aspectRatio,
        resolution,
        ...(args.style === undefined ? {} : { style: args.style }),
        ...(references.length > 0 ? { inputImages: references.map((r) => r.dataUri) } : {}),
      }
      const taskSignal = AbortSignal.any([exec.signal, AbortSignal.timeout(config.timeoutMs)])

      // 异步路径：provider 支持 submit/poll 分离（KIE）→ 提交即返回，后台调度器
      // 轮询。agent 的 turn 立即结束、恢复空闲，可以继续接收下一个生成请求
      // （并发提交、互不阻塞）——这是「并发生图」的根。
      if (isAsyncProvider(provider)) {
        const asyncTask = await provider.submitImage(request, taskSignal)
        const session = sessionOf(exec)
        if (session !== undefined) {
          try {
            const before = foldCanvas(session.snapshotEvents())
            // 拓扑由 agent 的 inputImages 决定（不再依赖画布 Phase 1 的预判）：
            //   - 传 1 张参考图 → 该图右侧挂独立占位（fan-out，模式A）
            //   - 传 N 张参考图 → 1 个融合占位，N 张图全连它（merge，模式B）
            //   - 传 0 张 → 文生图网格占位
            const refIds = references
              .map((r) => r.attachmentId)
              .filter((id): id is string => id !== undefined)
            const refNodes = refIds
              .map((id) => before.nodes.find((n) => n.url === id))
              .filter((n): n is NonNullable<typeof n> => n !== undefined)
            const meta = { pending: true, taskId: asyncTask.taskId, provider: provider.id, model: asyncTask.model, prompt: request.prompt }
            let next = before
            // 复用「用户手动连线」的空白下游节点：如果参考图节点已有一条边
            // 连到 blank image 节点（无 url、非 pending），说明用户已经画好了
            // 链，就在那里生图，不新建卡片。否则才走下面的 fan-out/merge 新建。
            const bound = new Set<string>()
            for (const src of refNodes) {
              const blankEdge = before.edges.find((e) => {
                if (e.source !== src.id) return false
                const t = before.nodes.find((n) => n.id === e.target)
                return t !== undefined
                  && t.kind === 'image'
                  && (t.url === undefined || t.url === '')
                  && t.meta?.pending !== true
              })
              if (blankEdge === undefined) continue
              const target = before.nodes.find((n) => n.id === blankEdge.target)
              if (target === undefined) continue
              next = updateNode(next, target.id, { label: '生成中…', meta: { ...(target.meta ?? {}), ...meta } })
              bound.add(src.id)
            }
            const unbound = refNodes.filter((n) => !bound.has(n.id))
            if (unbound.length === 1) {
              const src = unbound[0]!
              const ph = addNode(next, { kind: 'image', label: '生成中…', x: src.x + 340, y: src.y, meta })
              next = ph.state
              next = addEdge(next, { source: src.id, target: ph.node.id }).state
            } else if (unbound.length > 1) {
              const xs = unbound.map((n) => n.x)
              const ys = unbound.map((n) => n.y)
              const ph = addNode(next, {
                kind: 'image',
                label: '生成中…',
                x: Math.max(...xs) + 340,
                y: (Math.min(...ys) + Math.max(...ys)) / 2,
                meta,
              })
              next = ph.state
              for (const src of unbound) {
                next = addEdge(next, { source: src.id, target: ph.node.id }).state
              }
            } else if (refNodes.length === 0) {
              const reuse = next.nodes.find((n) => n.meta?.pending === true && n.meta.taskId === undefined)
              next = reuse !== undefined
                ? updateNode(next, reuse.id, { label: '生成中…', meta: { ...(reuse.meta ?? {}), ...meta } })
                : addNode(next, {
                    kind: 'image',
                    label: '生成中…',
                    x: (next.nodes.length % 4) * 220,
                    y: Math.floor(next.nodes.length / 4) * 180,
                    meta,
                  }).state
            }
            session.append('canvas/state', { state: next })
          } catch (error) {
            console.error('[ldd-generate] 挂占位节点失败:', error)
          }
          // 会话框进度卡片：独立于画布，始终追加。用户即使不开画布，也能在
          // 会话框里看到「正在生成」的任务进度卡片（notice 形式，前端渲染为
          // 可折叠的上下文消息卡片）。完成后 scheduler 会追加结果图片。
          try {
            session.append('user/message', {
              id: crypto.randomUUID(),
              role: 'user',
              content: [{ type: 'text', text: `🖼️ 正在生成图片…（${count} 张）` }],
              source: { kind: 'generate', form: 'notice', summary: `正在生成图片…（${count} 张）` },
            }, { surfaceOp: 'append' })
          } catch (error) {
            console.error('[ldd-generate] 追加进度卡片失败:', error)
          }
        }
        scheduler.submit(sessionId ?? '', provider, asyncTask)
        return { images: [], provider: provider.id, model: asyncTask.model, submitted: true, taskId: asyncTask.taskId }
      }

      // 同步路径（Legnext / mock / openai-compatible 等 per-account 串行或一次性协议）。
      const result = await provider.generateImage(request, taskSignal)
      const store = attachments.current
      const images = []
      for (const image of result.images) {
        const meta = store !== undefined
          ? await attachImageFromUrl(image.url, store, taskSignal)
          : undefined
        images.push({
          index: image.index,
          url: image.url,
          width: image.width,
          height: image.height,
          prompt: image.prompt,
          ...(meta !== undefined ? { attachment: meta } : {}),
        })
      }
      return { images, provider: result.provider, model: result.model, submitted: false }
    },
  })
}

function defineVideoTool(
  resolved: ResolvedModels,
  config: Config,
  secret: { resolve: SecretResolver },
  sessionOverrides: { get(key: string): string | undefined },
) {
  const providerKeys = resolved.entries.map((entry) => entry.key)
  return defineTool({
    name: 'generate_video',
    description:
      'Generate a short video from a text prompt using a video-generation model. Call this when the user asks to create, produce, or imagine a video clip, animation, or moving scene. Returns a video reference, duration, resolution, and aspect ratio.\n\n'
      + 'Available models (pick `provider` by need, or omit to use the default):\n'
      + modelCatalog(resolved, VIDEO_PROVIDER_PRESETS),
    parameters: {
      prompt: { type: 'string', required: true, description: 'The video description: subject, action, camera movement, scene, lighting, mood, pacing. Rewrite the user intent into a rich scene prompt.' },
      provider: { type: 'string', enum: providerKeys, description: 'Which configured model to use. Omit to use the user\'s selected model (or the default when none is selected).' },
      durationSeconds: { type: 'number', description: 'Target duration in seconds (1-30).' },
      resolution: { type: 'string', enum: [...videoResolutions], description: 'Target video resolution.' },
      aspectRatio: { type: 'string', enum: [...videoAspectRatios], description: 'Target frame aspect ratio; use 9:16 for vertical short-video.' },
    },
    output: {
      schema: videoResultSchema,
      render: (_args, value) => {
        // Emit each video as a `video` block (the frontend renders an inline
        // player) plus a text line carrying the URL (the model reads the URL to
        // describe the result). The harness frontend has no video renderer for
        // tool results by default — the video block is rendered by the LDD
        // generate plugin's own toolview (registered under `tool.call.toolview`
        // key `generate_video`). Without that toolview the video block degrades
        // to JSON text, so the URL line keeps the result useful to the model.
        const blocks: Array<{ type: 'text'; text: string } | { type: 'video'; url: string; title: string; durationSeconds: number }> = []
        for (const video of value.videos) {
          blocks.push({
            type: 'video',
            url: video.url,
            title: `视频 ${video.index}`,
            durationSeconds: video.durationSeconds,
          })
          blocks.push({
            type: 'text',
            text: `视频 ${video.index}（${video.durationSeconds}s ${video.resolution} ${video.aspectRatio}）：${video.url}`,
          })
        }
        return blocks as any
      },
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const sessionId = (exec as unknown as { agent?: { id?: string } }).agent?.id
      const entry = resolveProvider(resolved, args.provider, sessionId, sessionOverrides)
      const provider = await buildProvider(entry, VIDEO_PROVIDER_PRESETS, secret.resolve)
      const durationSeconds = args.durationSeconds === undefined
        ? 5
        : Math.max(1, Math.min(maxVideoDurationSeconds, Math.round(args.durationSeconds)))
      const request = {
        prompt: args.prompt,
        durationSeconds,
        resolution: args.resolution ?? '1080p',
        aspectRatio: args.aspectRatio ?? '16:9',
      }
      const taskSignal = AbortSignal.any([exec.signal, AbortSignal.timeout(config.timeoutMs)])
      return await provider.generateVideo(request, taskSignal)
    },
  })
}

function defineMusicTool(
  resolved: ResolvedModels,
  config: Config,
  secret: { resolve: SecretResolver },
  attachments: { current?: AttachmentStoreLike },
  sessionOverrides: { get(key: string): string | undefined },
) {
  const providerKeys = resolved.entries.map((entry) => entry.key)
  return defineTool({
    name: 'generate_music',
    description:
      'Generate an AI music track from a prompt (optionally with lyrics) using a Suno music model. Call this when the user asks to create, compose, or produce a song, instrumental, background music, or melody. Returns the audio URL, title, duration, style tags, and a cover image.\n\n'
      + 'The audio is returned as a URL the user can play/download; describe the result in words, do not write markdown audio syntax.\n\n'
      + 'Two modes: non-custom (customMode=false, only a prompt, lyrics auto-generated) and custom (customMode=true, you supply style/title and — when instrumental=false — the exact lyrics as the prompt).\n\n'
      + 'Available models (pick `provider` by need, or omit to use the default):\n'
      + modelCatalog(resolved, MUSIC_PROVIDER_PRESETS),
    parameters: {
      prompt: { type: 'string', required: true, description: 'The music description. Non-custom mode: describe the mood/style/subject; the lyrics are auto-generated. Custom mode with lyrics (instrumental=false): the EXACT lyrics to sing, including [Verse]/[Chorus] section markers.' },
      provider: { type: 'string', enum: providerKeys, description: 'Which configured music model to use. Omit to use the user\'s selected model (or the default when none is selected).' },
      customMode: { type: 'boolean', description: 'True = custom mode (you supply style/title/lyrics); false (default) = simplified auto mode with only a prompt.' },
      instrumental: { type: 'boolean', description: 'True = instrumental (no lyrics). In custom mode this requires style+title; in non-custom mode it is ignored.' },
      style: { type: 'string', description: 'Music style (custom mode), e.g. Jazz, Classical, Electronic, Pop, Rock, Hip-hop.' },
      title: { type: 'string', description: 'Track title (custom mode), max 80 chars.' },
    },
    output: {
      schema: musicResultSchema,
      render: (_args, value) => {
        // Emit, per track: the cover image (an image block via the attachment
        // slot), an `audio` block (the frontend's audio renderer plays + offers
        // download), and a text line the model reads to describe the result.
        const blocks: Array<{ type: 'text'; text: string } | { type: 'image'; attachment: ImageMeta } | { type: 'audio'; url: string; title: string; durationSeconds: number }> = []
        for (const track of value.music) {
          if (track.coverAttachment !== undefined) {
            blocks.push(imageBlockOf(track.coverAttachment as ImageMeta))
          }
          blocks.push({
            type: 'audio',
            url: track.url,
            title: track.title || '未命名',
            durationSeconds: track.durationSeconds,
          })
          const duration = track.durationSeconds > 0 ? `（${Math.round(track.durationSeconds)} 秒）` : ''
          blocks.push({
            type: 'text',
            text: `🎵 ${track.title || '未命名'}${duration}${track.tags !== '' ? ` · ${track.tags}` : ''}\n${track.url}`,
          })
        }
        return blocks as any
      },
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const sessionId = (exec as unknown as { agent?: { id?: string } }).agent?.id
      const entry = resolveProvider(resolved, args.provider, sessionId, sessionOverrides)
      const provider = await buildProvider(entry, MUSIC_PROVIDER_PRESETS, secret.resolve)
      const request = {
        prompt: args.prompt,
        customMode: args.customMode === true,
        instrumental: args.instrumental === true,
        ...(args.style === undefined ? {} : { style: args.style }),
        ...(args.title === undefined ? {} : { title: args.title }),
      }
      const taskSignal = AbortSignal.any([exec.signal, AbortSignal.timeout(config.timeoutMs)])
      const result = await provider.generateMusic(request, taskSignal)
      const store = attachments.current
      const music = []
      for (const track of result.music) {
        const coverAttachment = store !== undefined && track.coverUrl !== ''
          ? await attachImageFromUrl(track.coverUrl, store, taskSignal)
          : undefined
        music.push({
          index: track.index,
          url: track.url,
          coverUrl: track.coverUrl,
          title: track.title,
          durationSeconds: track.durationSeconds,
          tags: track.tags,
          modelName: track.modelName,
          prompt: track.prompt,
          ...(coverAttachment !== undefined ? { coverAttachment } : {}),
        })
      }
      return { music, provider: result.provider, model: result.model }
    },
  })
}

/**
 * The switch tool: lets the agent honour a user's IN-CONVERSATION model request.
 * The per-session override is otherwise only settable through the composer
 * button (a `/generate-model` UI command the agent cannot invoke). Without this
 * tool, when a user says "改用 GPT Image 2" the agent tries the new model but
 * `resolveProvider` blocks it against the STALE override (the model picked
 * earlier), leaving the agent stuck asking the user to click the button. This
 * tool updates the override first, so the next generate call just works.
 *
 * It must ONLY be called when the user has asked to switch (the description is
 * the guard; the agent should never pick a model the user didn't name).
 */
function defineSwitchModelTool(
  state: { image: ResolvedModels; video: ResolvedModels; music: ResolvedModels },
  sessionOverrides: { image: Map<string, string>; video: Map<string, string>; music: Map<string, string> },
) {
  const catalog = (kind: 'image' | 'video' | 'music'): string => {
    const pair = kind === 'image'
      ? [state.image, IMAGE_PROVIDER_PRESETS] as const
      : kind === 'video'
        ? [state.video, VIDEO_PROVIDER_PRESETS] as const
        : [state.music, MUSIC_PROVIDER_PRESETS] as const
    return modelCatalog(pair[0], pair[1])
  }
  return defineTool({
    name: 'set_generation_model',
    description:
      '把当前会话的生成模型切换到用户指定的那一个。仅当用户明确要求更换或指定生成模型时调用（例如「改用 GPT Image 2」「换成 Seedream」「用 Nano Banana」）。切换后，后续的 generate_image / generate_video / generate_music 会使用新模型。用户没有要求换模型时不要调用。\n\n'
      + '可用模型（provider 必须取对应类别列表里「- 」开头的键）：\n'
      + '【image 生图】\n' + catalog('image') + '\n'
      + '【video 生视频】\n' + catalog('video') + '\n'
      + '【music 生音乐】\n' + catalog('music'),
    parameters: {
      kind: { type: 'string', enum: ['image', 'video', 'music'], required: true, description: '要切换的生成类别：image=生图，video=生视频，music=生音乐。' },
      provider: { type: 'string', required: true, description: '目标模型的路由键（上面类别列表里「- 」开头的那串键，例如 kie:gpt-image-2-text-to-image）。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          switched: { type: 'boolean', required: true },
          kind: { type: 'string', required: true },
          provider: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `已切换${value.kind === 'image' ? '生图' : value.kind === 'video' ? '生视频' : '生音乐'}模型到「${value.provider}」。`,
      }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const sessionId = (exec as unknown as { agent?: { id?: string } }).agent?.id
      if (sessionId === undefined || sessionId === '') {
        throw new Error('set_generation_model 需要当前会话（无法确定会话身份）')
      }
      const kind = args.kind as 'image' | 'video' | 'music'
      const resolved = kind === 'image' ? state.image : kind === 'video' ? state.video : state.music
      // pickProvider validates the key and returns its canonical form.
      const entry = pickProvider(resolved, args.provider as string | undefined)
      sessionOverrides[kind].set(sessionId, entry.key)
      return { switched: true, kind, provider: entry.key }
    },
  })
}

export function apply(ctx: Context, config: Config): void {
  // Live routing state. Defaults to a single mock entry and is re-resolved on
  // every settings change. `registerTools` disposes and re-registers the two
  // tools so the model-facing `provider` enum and catalog track the list.
  const state = {
    image: resolveModels(config.image.get() as unknown as ImageGenerationSettings | undefined, IMAGE_PROVIDER_PRESETS),
    video: resolveModels(config.video.get() as unknown as VideoGenerationSettings | undefined, VIDEO_PROVIDER_PRESETS),
    music: resolveModels(config.music.get() as unknown as MusicGenerationSettings | undefined, MUSIC_PROVIDER_PRESETS),
  }
  let disposeImage: (() => void) | undefined
  let disposeVideo: (() => void) | undefined
  let disposeMusic: (() => void) | undefined
  let disposeSwitch: (() => void) | undefined

  // Per-session generation-model override, set by the composer's
  // `generate-model` button command and read by the tools. Keyed by the stable
  // SessionId STRING (not the live Session object): the command handler and the
  // tool execution can observe the same session through different agent
  // wrappers (resume recreates the Session object; a subagent's `agent` differs
  // from its parent's), so object-identity keying would drop or leak the pick
  // across sessions. A SessionId is the canonical per-session identity and
  // vanishes with the session (the settings `default` is never touched).
  //
  // SEPARATE per modality (image/video/music): the picker lists all three and
  // the agent routes each task type to ITS OWN model. A single shared map was
  // the bug that made "pick an image model" then break music/video calls (the
  // image key leaked into the other tools' resolveProvider and failed to pick).
  const sessionOverrides = {
    image: new Map<string, string>(),
    video: new Map<string, string>(),
    music: new Map<string, string>(),
  }

  // Surface a per-session generation-model pick (the composer button) into the
  // model's runtime context, so the agent honours it from the FIRST tool call
  // instead of routing by strengths and then being blocked by resolveProvider.
  // Re-evaluated every assembly, so the pick stays visible across steps. The
  // service is optional (headless hosts without systemPrompt just skip it).
  ctx.inject(['systemPrompt'], (spCtx) => {
    const systemPrompt = (spCtx as unknown as {
      systemPrompt?: {
        context: (entry: {
          name: string
          order: number
          text: string | ((assemble: { agent?: { id?: string } }) => string)
        }) => () => void
      }
    }).systemPrompt
    systemPrompt?.context({
      name: 'generate:model-pick',
      order: 200,
      text: (assemble) => {
        const sessionId = assemble.agent?.id
        if (sessionId === undefined) return ''
        return modelPickContextText(
          sessionOverrides.image.get(sessionId),
          sessionOverrides.video.get(sessionId),
          sessionOverrides.music.get(sessionId),
        )
      },
    })
  })

  // Secret resolver: env-only by default, upgraded to the harness credentials
  // service (env + store + .env) when it is present, so the settings card's
  // "API Key" field (credentials store) actually reaches the provider.
  const secret: { resolve: SecretResolver } = { resolve: environmentSecretResolver }
  ctx.inject(['credentials'], (credCtx) => {
    secret.resolve = credentialsServiceResolver(credCtx.credentials)
  })

  // Attachment store: optional. When mounted, generated image URLs are
  // downloaded and stored so they render IN the conversation; without it the
  // tools still work but return plain-text references.
  const attachments: { current?: AttachmentStoreLike } = {}
  ctx.inject(['attachments'], (attCtx) => {
    attachments.current = (attCtx as unknown as { attachments: AttachmentStoreLike }).attachments
  })

  // Sessions store: the background scheduler resolves the live Session by id so
  // it can write a finished image back onto the canvas (`canvas/state` event).
  // Read via a structural cast on `ctx.inject` — the generate package's single
  // tsconfig compiles host + client halves together, so a direct `ctx.sessions`
  // property access would surface the SessionStore/ISessions declaration split.
  let sessions: SessionStoreLike | undefined
  ctx.inject(['sessions'], (sessCtx) => {
    sessions = (sessCtx as unknown as { sessions: SessionStoreLike }).sessions
  })

  // Background generation scheduler: polls in-flight async tasks and fills the
  // canvas placeholder on completion. Disposed when the plugin unmounts.
  const scheduler = new GenerationScheduler(() => sessions, () => attachments.current)
  ctx.effect(() => () => scheduler.dispose(), 'generate: dispose scheduler')

  // The composer button's slash command: `/<provider-key>` temporarily routes
  // the current session's generation to that model; `default`/`clear` restores
  // the settings default. Optional (headless hosts have no command registry).
  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.commands?.register({
      name: 'generate-model',
      description: '为当前会话临时选择生成模型（图片/视频/音乐），或恢复默认',
      input: { hint: '<image|video|music> <provider-key | default>' },
      recordInput: false,
      handler: ({ agent, rawInput }) => {
        const parts = rawInput.trim().split(/\s+/).filter(Boolean)
        const sessionId = agent.id
        const kinds = ['image', 'video', 'music'] as const
        let kind: 'image' | 'video' | 'music' = 'image'
        let key = ''
        if (parts.length > 0 && (kinds as readonly string[]).includes(parts[0]!)) {
          kind = parts[0] as 'image' | 'video' | 'music'
          key = parts.slice(1).join(' ')
        } else {
          key = parts.join(' ')
        }
        const kindLabel = kind === 'image' ? '生图' : kind === 'video' ? '生视频' : '生音乐'
        if (key === '' || key === 'default' || key === 'clear') {
          sessionOverrides[kind].delete(sessionId)
          return { kind: 'success', text: `已恢复默认${kindLabel}模型。` }
        }
        sessionOverrides[kind].set(sessionId, key)
        return { kind: 'success', text: `已临时切换到${kindLabel}模型「${key}」（仅当前会话，不改默认）。` }
      },
    })
  })

  const registerTools = (): void => {
    disposeImage?.()
    disposeVideo?.()
    disposeMusic?.()
    disposeSwitch?.()
    disposeImage = ctx.tools.register(defineImageTool(state.image, config, secret, attachments, sessionOverrides.image, scheduler))
    disposeVideo = ctx.tools.register(defineVideoTool(state.video, config, secret, sessionOverrides.video))
    disposeMusic = ctx.tools.register(defineMusicTool(state.music, config, secret, attachments, sessionOverrides.music))
    disposeSwitch = ctx.tools.register(defineSwitchModelTool(state, sessionOverrides))
  }
  registerTools()

  // 0.2.0 settings: the namespace is derived from the plugin entry id and the
  // three generation halves are volatile Config fields. Re-resolve the routing
  // view and re-register the tools live on every volatile update (the browser
  // writes through `remote.settings.mutate`, which lands here).
  const syncFromConfig = (): void => {
    state.image = resolveModels(config.image.get() as unknown as ImageGenerationSettings | undefined, IMAGE_PROVIDER_PRESETS)
    state.video = resolveModels(config.video.get() as unknown as VideoGenerationSettings | undefined, VIDEO_PROVIDER_PRESETS)
    state.music = resolveModels(config.music.get() as unknown as MusicGenerationSettings | undefined, MUSIC_PROVIDER_PRESETS)
    registerTools()
  }
  ctx.on('loader/volatile-update', syncFromConfig)
  // Keep the settings page from auto-generating a redundant form (the generate
  // plugin ships its own three-tab UI); the namespace still appears in
  // `settings.describe` so the browser can read/edit it.
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })
}
