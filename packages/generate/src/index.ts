import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

import { imageSizes, maxImagesPerRequest, maxVideoDurationSeconds, videoAspectRatios, videoResolutions } from './config.ts'
import type { GenerationConfig } from './config.ts'
import { MockGenerationProvider } from './provider.ts'
import type { GenerationProvider } from './provider.ts'
import type { ResolvedGenerationConfig } from './types.ts'

export const name = 'ldd-generate'
export const inject = ['tools']

export interface Config extends GenerationConfig {}

export const Config: z<Config> = z.object({
  provider: z.string().required(),
  model: z.string().required(),
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

/**
 * Provider registry. The mock is the only shipped implementation; a real
 * image/video backend registers here by keying off `config.provider` without
 * touching the tool definitions or plugin-tree wiring.
 */
const providers: Record<string, GenerationProvider> = {
  mock: new MockGenerationProvider(),
}

function resolveProvider(config: ResolvedGenerationConfig): GenerationProvider {
  const provider = providers[config.provider]
  if (provider === undefined) {
    throw new Error(`unknown generation provider "${config.provider}" (available: ${Object.keys(providers).join(', ')})`)
  }
  return provider
}

export function apply(ctx: Context, config: Config): void {
  const resolved: ResolvedGenerationConfig = {
    provider: config.provider,
    model: config.model,
    timeoutMs: config.timeoutMs,
  }

  ctx.tools.register(defineTool({
    name: 'generate_image',
    description: 'Generate one or more images from a text prompt using an image-generation model. Call this when the user asks to create, draw, render, or imagine a picture, illustration, poster, avatar, or any visual asset. Returns image references (URL/data URI), dimensions, and the prompt used.',
    parameters: {
      prompt: { type: 'string', required: true, description: 'The image description. Be concrete and detailed: subject, style, composition, lighting, palette, mood. Rewrite the user intent into a rich visual prompt.' },
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
      const provider = resolveProvider(resolved)
      const count = args.count === undefined ? 1 : Math.max(1, Math.min(maxImagesPerRequest, args.count))
      const request = {
        prompt: args.prompt,
        count,
        size: args.size ?? '1024x1024',
        ...(args.style === undefined ? {} : { style: args.style }),
      }
      const taskSignal = AbortSignal.any([exec.signal, AbortSignal.timeout(resolved.timeoutMs)])
      return await provider.generateImage(request, taskSignal)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'generate_video',
    description: 'Generate a short video from a text prompt using a video-generation model. Call this when the user asks to create, produce, or imagine a video clip, animation, or moving scene. Returns a video reference, duration, resolution, and aspect ratio.',
    parameters: {
      prompt: { type: 'string', required: true, description: 'The video description: subject, action, camera movement, scene, lighting, mood, pacing. Rewrite the user intent into a rich scene prompt.' },
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
      const provider = resolveProvider(resolved)
      const durationSeconds = args.durationSeconds === undefined
        ? 5
        : Math.max(1, Math.min(maxVideoDurationSeconds, Math.round(args.durationSeconds)))
      const request = {
        prompt: args.prompt,
        durationSeconds,
        resolution: args.resolution ?? '1080p',
        aspectRatio: args.aspectRatio ?? '16:9',
      }
      const taskSignal = AbortSignal.any([exec.signal, AbortSignal.timeout(resolved.timeoutMs)])
      return await provider.generateVideo(request, taskSignal)
    },
  }))
}
