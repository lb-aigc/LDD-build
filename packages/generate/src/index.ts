import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

import { imageSizes, maxImagesPerRequest, maxVideoDurationSeconds, videoAspectRatios, videoResolutions } from './config.ts'
import type { GenerationConfig } from './config.ts'
import { IMAGE_PROVIDER_PRESETS, VIDEO_PROVIDER_PRESETS } from './presets.ts'
import {
  buildProvider,
  modelCatalog,
  pickProvider,
  resolveModels,
} from './routing.ts'
import type { ResolvedModels } from './routing.ts'
import {
  IMAGE_SETTINGS_NS,
  VIDEO_SETTINGS_NS,
  ImageGenerationSettingsSchema,
  VideoGenerationSettingsSchema,
} from './settings.ts'

export const name = 'ldd-generate'
export const inject = ['tools']

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

function defineImageTool(resolved: ResolvedModels, config: Config) {
  const providerKeys = resolved.entries.map((entry) => entry.key)
  return defineTool({
    name: 'generate_image',
    description:
      'Generate one or more images from a text prompt using an image-generation model. Call this when the user asks to create, draw, render, or imagine a picture, illustration, poster, avatar, or any visual asset. Returns image references (URL/data URI), dimensions, and the prompt used.\n\n'
      + 'Available models (pick `provider` by need, or omit to use the default):\n'
      + modelCatalog(resolved, IMAGE_PROVIDER_PRESETS),
    parameters: {
      prompt: { type: 'string', required: true, description: 'The image description. Be concrete and detailed: subject, style, composition, lighting, palette, mood. Rewrite the user intent into a rich visual prompt.' },
      provider: { type: 'string', enum: providerKeys, description: 'Which configured model to use. Match the request to the model whose strengths fit (see the catalog above); omit to use the default model.' },
      count: { type: 'integer', description: 'How many image variants to generate (1-4).' },
      size: { type: 'string', enum: [...imageSizes], description: 'Target image size/orientation.' },
      style: { type: 'string', description: 'Optional visual style keyword (e.g. photorealistic, anime, watercolor, cyberpunk).' },
    },
    output: {
      schema: imageResultSchema,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const entry = pickProvider(resolved, args.provider)
      const provider = buildProvider(entry, IMAGE_PROVIDER_PRESETS)
      const count = args.count === undefined ? 1 : Math.max(1, Math.min(maxImagesPerRequest, args.count))
      const request = {
        prompt: args.prompt,
        count,
        size: args.size ?? '1024x1024',
        ...(args.style === undefined ? {} : { style: args.style }),
      }
      const taskSignal = AbortSignal.any([exec.signal, AbortSignal.timeout(config.timeoutMs)])
      return await provider.generateImage(request, taskSignal)
    },
  })
}

function defineVideoTool(resolved: ResolvedModels, config: Config) {
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
      const entry = pickProvider(resolved, args.provider)
      const provider = buildProvider(entry, VIDEO_PROVIDER_PRESETS)
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

  const registerTools = (): void => {
    disposeImage?.()
    disposeVideo?.()
    disposeImage = ctx.tools.register(defineImageTool(state.image, config))
    disposeVideo = ctx.tools.register(defineVideoTool(state.video, config))
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
