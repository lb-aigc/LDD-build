import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

import { imageAspectRatios, imageResolutions, maxImagesPerRequest, maxVideoDurationSeconds, videoAspectRatios, videoResolutions } from './config.ts'
import type { GenerationConfig, ImageAspectRatio, ImageResolution, ImageSize } from './config.ts'
import { credentialsServiceResolver, environmentSecretResolver } from './credentials.ts'
import type { SecretResolver } from './credentials.ts'
import { attachImageFromUrl, imageBlockOf } from './attach.ts'
import type { AttachmentStoreLike, ImageMeta } from './attach.ts'
import { aspectRatioToImageSize } from './provider.ts'
import { collectUploadedImages } from './uploaded-images.ts'
import type { UploadedAgentLike } from './uploaded-images.ts'
import { CUSTOM_PROVIDER_ID, IMAGE_PROVIDER_PRESETS, VIDEO_PROVIDER_PRESETS, findPreset } from './presets.ts'
import {
  buildProvider,
  modelCatalog,
  pickProvider,
  resolveModels,
} from './routing.ts'
import type { ResolvedModels, RoutedModel } from './routing.ts'
import {
  IMAGE_SETTINGS_NS,
  VIDEO_SETTINGS_NS,
  ImageGenerationSettingsSchema,
  VideoGenerationSettingsSchema,
} from './settings.ts'

export const name = 'ldd-generate'
export const inject = ['tools', 'commands']

export interface Config extends GenerationConfig {}

export const Config: z<Config> = z.object({
  timeoutMs: z.natural().min(1).required(),
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

/** Whether a routed model supports image-to-image generation. Presets declare
 *  it explicitly; custom entries derive it from their protocol (MJ relays are
 *  excluded — their i2i consistency is too poor to expose). */
function supportsImageToImage(entry: RoutedModel): boolean {
  if (entry.provider === CUSTOM_PROVIDER_ID) {
    return entry.protocol !== 'midjourney' && entry.protocol !== 'legnext'
  }
  return findPreset(IMAGE_PROVIDER_PRESETS, entry.provider)?.imageToImage ?? false
}

/** Resolve the `inputImages` tool argument, expanding the `@uploaded` sentinel
 *  into the user's most recently uploaded images (data URIs read back from the
 *  attachment store). */
async function resolveReferenceImages(
  inputImages: unknown,
  exec: { agent?: UploadedAgentLike; signal: AbortSignal },
  store: AttachmentStoreLike | undefined,
): Promise<string[]> {
  const raw = Array.isArray(inputImages) ? inputImages.filter((entry): entry is string => typeof entry === 'string') : []
  if (raw.length === 0) return []
  const wantsUploaded = raw.some((entry) => entry === '@uploaded' || entry === '@latest')
  const explicit = raw.filter((entry) => entry !== '@uploaded' && entry !== '@latest')
  if (!wantsUploaded) return explicit
  const uploaded = await collectUploadedImages(exec.agent?.session, store, exec.signal)
  return [...explicit, ...uploaded]
}

function defineImageTool(
  resolved: ResolvedModels,
  config: Config,
  secret: { resolve: SecretResolver },
  attachments: { current?: AttachmentStoreLike },
  sessionOverrides: { get(key: object): string | undefined },
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
      provider: { type: 'string', enum: providerKeys, description: 'Which configured model to use. Match the request to the model whose strengths fit (see the catalog above); omit to use the default model.' },
      count: { type: 'integer', description: 'How many image variants to generate (1-4).' },
      aspectRatio: { type: 'string', enum: [...imageAspectRatios], description: 'Target aspect ratio. Choose from the enum to match the composition: 16:9 and 9:16 for horizontal/vertical widescreen, 1:1 square, 4:3 / 3:4 classic photo, 2:1 / 1:2 cinematic, 4:5 / 5:4 portrait/landscape, 21:9 / 9:21 ultra-wide. Omit to default to 16:9.' },
      resolution: { type: 'string', enum: [...imageResolutions], description: 'Output resolution tier: 4K / 2K / 1K. Always request 4K FIRST; the provider automatically degrades to 2K or 1K only when the chosen aspect ratio does not support the higher tier (1:1 caps at 2K; 4:5 / 5:4 / 9:21 cap at 1K). Omit to default to 4K.' },
      style: { type: 'string', description: 'Optional visual style keyword (e.g. photorealistic, anime, watercolor, cyberpunk).' },
      inputImages: { type: 'array', items: { type: 'string' }, description: 'Reference images for image-to-image: an array of http(s) URLs or data URIs, or the sentinel "@uploaded" to use the user\'s most recently uploaded image(s). Use this to generate FROM existing images (e.g. turn a previously generated image into a different angle/view, or transform an image the user just uploaded). Only providers that support i2i accept it — Midjourney and Legnext reject it.' },
    },
    output: {
      schema: imageResultSchema,
      render: (_args, value) => {
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
            blocks.push(imageBlockOf(image.attachment as ImageMeta))
            blocks.push({ type: 'text', text: `图片 ${image.index}（${image.width}x${image.height}）：${image.url}` })
          } else {
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
      // Priority: an explicit tool `provider` (prompt/skill routing) wins over
      // a user's per-session button override, which wins over the default.
      const session = (exec as unknown as { agent?: { session?: object } }).agent?.session
      const requested = (args.provider !== undefined && args.provider !== '')
        ? args.provider
        : (session !== undefined ? sessionOverrides.get(session) : undefined)
      const entry = pickProvider(resolved, requested)
      const references = await resolveReferenceImages(
        args.inputImages,
        exec as unknown as { agent?: UploadedAgentLike; signal: AbortSignal },
        attachments.current,
      )
      if (references.length > 0 && !supportsImageToImage(entry)) {
        throw new Error(`provider "${entry.key}" 不支持图生图（Midjourney 图生图一致性差，已禁用）`)
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
        ...(references.length > 0 ? { inputImages: references } : {}),
      }
      const taskSignal = AbortSignal.any([exec.signal, AbortSignal.timeout(config.timeoutMs)])
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
      return { images, provider: result.provider, model: result.model }
    },
  })
}

function defineVideoTool(
  resolved: ResolvedModels,
  config: Config,
  secret: { resolve: SecretResolver },
  sessionOverrides: { get(key: object): string | undefined },
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
      provider: { type: 'string', enum: providerKeys, description: 'Which configured model to use; omit to use the default model.' },
      durationSeconds: { type: 'number', description: 'Target duration in seconds (1-30).' },
      resolution: { type: 'string', enum: [...videoResolutions], description: 'Target video resolution.' },
      aspectRatio: { type: 'string', enum: [...videoAspectRatios], description: 'Target frame aspect ratio; use 9:16 for vertical short-video.' },
    },
    output: {
      schema: videoResultSchema,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const session = (exec as unknown as { agent?: { session?: object } }).agent?.session
      const requested = (args.provider !== undefined && args.provider !== '')
        ? args.provider
        : (session !== undefined ? sessionOverrides.get(session) : undefined)
      const entry = pickProvider(resolved, requested)
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

export function apply(ctx: Context, config: Config): void {
  // Live routing state. Defaults to a single mock entry and is re-resolved on
  // every settings change. `registerTools` disposes and re-registers the two
  // tools so the model-facing `provider` enum and catalog track the list.
  const state = {
    image: resolveModels(undefined),
    video: resolveModels(undefined),
  }
  let disposeImage: (() => void) | undefined
  let disposeVideo: (() => void) | undefined

  // Per-session generation-model override, set by the composer's
  // `generate-model` button command and read by the tools. Keyed by the live
  // Session object (the same reference the command handler and tool execution
  // both receive for one session), so a button pick routes this session only
  // and vanishes with it — the settings `default` is never touched.
  const sessionOverrides = new WeakMap<object, string>()

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

  // The composer button's slash command: `/<provider-key>` temporarily routes
  // the current session's generation to that model; `default`/`clear` restores
  // the settings default. Optional (headless hosts have no command registry).
  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.commands?.register({
      name: 'generate-model',
      description: '为当前会话临时选择生图模型，或恢复默认',
      input: { hint: '<provider-key | default>' },
      recordInput: false,
      handler: ({ agent, rawInput }) => {
        const key = rawInput.trim()
        const session = agent.session as object
        if (key === '' || key === 'default' || key === 'clear') {
          sessionOverrides.delete(session)
          return { kind: 'success', text: '已恢复默认生图模型。' }
        }
        sessionOverrides.set(session, key)
        return { kind: 'success', text: `已临时切换到生图模型「${key}」（仅当前会话，不改默认）。` }
      },
    })
  })

  const registerTools = (): void => {
    disposeImage?.()
    disposeVideo?.()
    disposeImage = ctx.tools.register(defineImageTool(state.image, config, secret, attachments, sessionOverrides))
    disposeVideo = ctx.tools.register(defineVideoTool(state.video, config, secret, sessionOverrides))
  }
  registerTools()

  // Best-effort settings registration: without a settings provider (headless
  // boot) the tools keep their mock defaults. When present, every edit
  // re-resolves the routing view and re-registers the tools live.
  ctx.inject(['settings'], (settingsCtx) => {
    const imageScope = settingsCtx.settings.register(
      IMAGE_SETTINGS_NS,
      ImageGenerationSettingsSchema,
    )
    const videoScope = settingsCtx.settings.register(
      VIDEO_SETTINGS_NS,
      VideoGenerationSettingsSchema,
    )
    const sync = () => {
      state.image = resolveModels(imageScope.get())
      state.video = resolveModels(videoScope.get())
      registerTools()
    }
    sync()
    imageScope.watch(sync)
    videoScope.watch(sync)
  })
}
