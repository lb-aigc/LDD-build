import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute } from 'node:path'

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { FinishReason, GenerateOptions, Message, PreparedLlmCall } from '@deepseek-ai/dsh-llm'
import { BlockAssembler, deepFreeze, freezeMessage, MessageId } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { KNOWN_SESSION_EVENT_TYPES, type SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-session/types'

import {
  analyzeVideo,
  type PreparedVideoVisionCall,
  type ResolvedVideoAnalyzerConfig,
  type VideoAnalyzerDependencies,
} from './analyzer.ts'
import { boundedVisionStream } from './bounded-stream.ts'
import { maxVideoFileBytes, type AnalysisPrecision } from './config.ts'
import { authorizeVideoPath, probeVideo } from './media-probe.ts'
import { VideoMediaRuntime } from './media-runtime.ts'
import { runManagedSubprocess } from './subprocess-runner.ts'
import { registerVideoAnalysisSessionEvent } from './session-compat.ts'
import { withTempMedia } from './temp-media.ts'
import type {
  AnalyzeVideoInput,
  VideoAnalysisInputRecord,
  VideoImageRef,
} from './types.ts'

export const name = 'ldd-video-frame-analyzer'
export const inject = ['tools', 'attachments', 'fs', 'llm', 'webServer', 'subprocess']

registerVideoAnalysisSessionEvent(KNOWN_SESSION_EVENT_TYPES)

export interface Config {
  readonly provider: string
  readonly model: string
  readonly defaultPrecision: AnalysisPrecision
  readonly maxTokens: number
  readonly timeoutMs: number
  readonly ffmpegPath: string
  readonly ffprobePath: string
  readonly cacheRoot: string
  readonly sceneThreshold: number
  readonly stopGraceMs: number
}

export const Config: z<Config> = z.object({
  provider: z.string().required(),
  model: z.string().required(),
  defaultPrecision: z.union([z.const('low'), z.const('balanced'), z.const('high')]).required(),
  maxTokens: z.natural().min(1).max(16_384).required(),
  timeoutMs: z.natural().min(1).required(),
  ffmpegPath: z.string().required(),
  ffprobePath: z.string().required(),
  cacheRoot: z.string().required(),
  sceneThreshold: z.number().min(0.001).max(0.999).required(),
  stopGraceMs: z.natural().min(1).required(),
})

const imageRefSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    attachmentId: { type: 'string', required: true },
    mediaType: { type: 'string', enum: ['image/jpeg'], required: true },
    bytes: { type: 'integer', required: true },
    width: { type: 'integer', required: true },
    height: { type: 'integer', required: true },
    name: { type: 'string' },
  },
} as const

const observationSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    startSeconds: { type: 'number', required: true },
    endSeconds: { type: 'number', required: true },
    summary: { type: 'string', required: true },
    visibleText: { type: 'array', items: { type: 'string' }, required: true },
    evidenceTimestamps: { type: 'array', items: { type: 'number' }, required: true },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'], required: true },
  },
} as const

const resultSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    analysisId: { type: 'string', required: true },
    metadata: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: {
        durationSeconds: { type: 'number', required: true },
        width: { type: 'integer', required: true },
        height: { type: 'integer', required: true },
        frameRate: { type: 'number', required: true },
        hasAudio: { type: 'boolean', required: true },
        format: { type: 'string', enum: ['mp4', 'mov', 'mkv', 'webm'], required: true },
      },
    },
    strategy: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: {
        precision: { type: 'string', enum: ['low', 'balanced', 'high'], required: true },
        intervalSeconds: { type: 'number', required: true },
        frameCount: { type: 'integer', required: true },
        contactSheetCount: { type: 'integer', required: true },
        truncated: { type: 'boolean', required: true },
      },
    },
    observations: { type: 'array', items: observationSchema, required: true },
    coverage: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: {
        analyzedRange: {
          type: 'object',
          additionalProperties: false,
          required: true,
          properties: {
            startSeconds: { type: 'number', required: true },
            endSeconds: { type: 'number', required: true },
          },
        },
        uncoveredIntervals: {
          type: 'array',
          required: true,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              startSeconds: { type: 'number', required: true },
              endSeconds: { type: 'number', required: true },
            },
          },
        },
      },
    },
    contactSheets: { type: 'array', items: imageRefSchema, required: true },
    decodeWarnings: { type: 'array', items: { type: 'string' }, required: true },
    warnings: { type: 'array', items: { type: 'string' }, required: true },
    provider: { type: 'string', required: true },
    model: { type: 'string', required: true },
    requestCount: { type: 'integer', required: true },
  },
} as const

export function apply(ctx: Context, config: Config): void {
  validateConfig(config)
  registerIdentityRoute(ctx)
  const lifecycle = new AbortController()
  const mediaRuntime = new VideoMediaRuntime(config, ctx.subprocess)
  const analyzerConfig: ResolvedVideoAnalyzerConfig = {
    provider: config.provider,
    model: config.model,
    defaultPrecision: config.defaultPrecision,
    maxTokens: config.maxTokens,
    timeoutMs: config.timeoutMs,
  }

  ctx.tools.register(defineTool({
    name: 'analyze_video',
    description: 'Analyze an MP4, MOV, MKV, or WebM file in the current workspace. The tool probes the video locally, extracts bounded timestamped contact sheets with LDD FFmpeg, asks an image-capable model for structured observations, and returns evidence timestamps. Use a start/end range for videos above 60 minutes.',
    parameters: {
      path: { type: 'string', required: true, description: 'Video path inside the current session workspace.' },
      goal: { type: 'string', required: true, description: 'What to observe or answer from the video.' },
      startSeconds: { type: 'number', description: 'Optional inclusive analysis start in seconds.' },
      endSeconds: { type: 'number', description: 'Optional analysis end in seconds.' },
      precision: { type: 'string', enum: ['low', 'balanced', 'high'], description: 'Sampling precision; balanced is the deployment default.' },
    },
    output: {
      schema: resultSchema,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) throw new Error('analyze_video requires a calling agent and durable Session')
      const input: AnalyzeVideoInput = {
        path: args.path,
        goal: args.goal,
        ...(args.startSeconds === undefined ? {} : { startSeconds: args.startSeconds }),
        ...(args.endSeconds === undefined ? {} : { endSeconds: args.endSeconds }),
        ...(args.precision === undefined ? {} : { precision: args.precision }),
      }
      const taskSignal = AbortSignal.any([exec.signal, lifecycle.signal])
      const result = await analyzeVideo(input, taskSignal, createDependencies(
        ctx,
        config,
        analyzerConfig,
        mediaRuntime,
        exec,
        taskSignal,
      ))
      return {
        ...result,
        observations: result.observations.map((observation) => ({
          ...observation,
          visibleText: [...observation.visibleText],
          evidenceTimestamps: [...observation.evidenceTimestamps],
        })),
        coverage: {
          analyzedRange: { ...result.coverage.analyzedRange },
          uncoveredIntervals: result.coverage.uncoveredIntervals.map((interval) => ({ ...interval })),
        },
        contactSheets: result.contactSheets.map((sheet) => ({ ...sheet })),
        decodeWarnings: [...result.decodeWarnings],
        warnings: [...result.warnings],
      }
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `Analyze video ${args.path}`,
      kind: 'read',
      locations: [{ path: args.path }],
    }),
  }))
  registerHealthRoute(ctx)
  // Registered last so Cordis' reverse-order disposal aborts active tasks
  // before it tears down the tool and its supporting services.
  ctx.effect(
    () => () => lifecycle.abort(new Error('ldd video analyzer plugin was unloaded')),
    'ldd-video-frame-analyzer lifecycle',
  )
}

function createDependencies(
  ctx: Context,
  config: Config,
  analyzerConfig: ResolvedVideoAnalyzerConfig,
  mediaRuntime: VideoMediaRuntime,
  exec: ToolExecution,
  taskSignal: AbortSignal,
): VideoAnalyzerDependencies {
  const agent = exec.agent
  if (agent === undefined) throw new Error('video analyzer dependencies require a calling agent')
  return {
    config: analyzerConfig,
    resolveInput: (path, signal) => resolveVideoInput(ctx, exec, path, signal),
    probe: (path, signal) => probeVideo(
      path,
      config.ffprobePath,
      signal,
      (executable, argv, runSignal) => runManagedSubprocess(
        ctx.subprocess,
        executable,
        argv,
        dirname(path),
        runSignal,
        { maxOutputBytes: 2 * 1024 * 1024, graceMs: config.stopGraceMs },
      ),
    ),
    prepareVision: (signal) => prepareVisionCall(
      ctx,
      agent.session.id,
      analyzerConfig,
      config.timeoutMs,
      signal,
    ),
    withTemp: (taskId, task) => withTempMedia({
      cacheRoot: config.cacheRoot,
      taskId,
      signal: taskSignal,
    }, task),
    detectScenes: (path, range, media) => mediaRuntime.detectScenes(path, range, media),
    renderContactSheet: (_path, plan, media) => mediaRuntime.renderContactSheet(plan, media),
    decodeWarnings: (media) => mediaRuntime.decodeWarnings(media),
    saveContactSheet: async (path, name, signal) => {
      const data = await readFile(path, { signal })
      const ref = await ctx.attachments.saveImage({ data, mediaType: 'image/jpeg', name })
      return imageRefValue(ref)
    },
    recordInput: (record) => {
      agent.session.append('video/analysis-input', record)
    },
  }
}

async function prepareVisionCall(
  ctx: Context,
  sessionId: SessionId,
  config: ResolvedVideoAnalyzerConfig,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<PreparedVideoVisionCall> {
  const prepared = await ctx.llm.prepareCall({
    provider: config.provider,
    model: config.model,
    maxTokens: config.maxTokens,
  }, signal)
  if (prepared.inputModalities === undefined || !prepared.inputModalities.includes('image')) {
    throw new Error(`video analysis model "${config.provider}/${config.model}" does not declare image input`)
  }
  if (prepared.config.maxTokens === undefined) {
    throw new Error('prepared video analysis call did not retain maxTokens')
  }
  return {
    provider: prepared.config.provider,
    model: prepared.config.model,
    maxTokens: prepared.config.maxTokens,
    invoke: (record, invokeSignal) => invokePreparedVision(
      prepared,
      sessionId,
      record,
      invokeSignal,
      timeoutMs,
    ),
  }
}

async function resolveVideoInput(
  ctx: Context,
  exec: ToolExecution,
  requestedPath: string,
  signal: AbortSignal,
): Promise<string> {
  const cwd = exec.agent?.session.header.cwd
  if (cwd === undefined) throw new Error('analyze_video requires a session workspace')
  const pathInfo = await ctx.fs.lstat(requestedPath, { cwd }, signal)
  if (pathInfo === undefined) throw new Error(`video not found: ${requestedPath}`)
  if (pathInfo.type === 'symlink') throw new Error('video path must not be a symbolic link')
  if (pathInfo.type !== 'file') throw new Error('video path must be a regular file')
  if (pathInfo.size !== undefined && pathInfo.size > maxVideoFileBytes) {
    throw new Error('video file exceeds the 2 GiB limit')
  }
  const [workspaceTarget, videoTarget] = await Promise.all([
    ctx.fs.resolve(cwd, { signal }),
    ctx.fs.resolve(requestedPath, { cwd, signal }),
  ])
  if (!ctx.fs.contains(workspaceTarget, videoTarget)) {
    throw new Error('video path is outside the current session workspace')
  }
  const info = await ctx.fs.stat(videoTarget, signal)
  if (info === undefined || info.type !== 'file') throw new Error('video path is not a regular file')
  if (info.size !== undefined && info.size > maxVideoFileBytes) {
    throw new Error('video file exceeds the 2 GiB limit')
  }
  const processPath = ctx.fs.processPath(videoTarget)
  const workspaceProcessPath = ctx.fs.processPath(workspaceTarget)
  const authorized = await authorizeVideoPath(processPath, workspaceProcessPath)
  ctx.emit('fs/observed', videoTarget, { kind: 'present', version: info.version }, exec)
  return authorized
}

async function invokePreparedVision(
  prepared: PreparedLlmCall,
  sessionId: SessionId,
  record: VideoAnalysisInputRecord,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<string> {
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
  const messages: Message[] = record.messages.map((message) => freezeMessage({
    id: MessageId(message.id),
    role: 'user',
    content: message.content.map((block) => block.type === 'text'
      ? { type: 'text' as const, text: block.text }
      : { type: 'image' as const, attachment: imageRefFromValue(block.attachment) }),
    source: message.source,
  }))
  const options: GenerateOptions = deepFreeze({
    ...prepared.config,
    messages,
    system: record.system,
    maxTokens: record.maxTokens,
    sessionId,
    signal: requestSignal,
  })
  const assembler = new BlockAssembler()
  for await (const chunk of boundedVisionStream(prepared.stream(options), {
    maxBytes: 1024 * 1024,
    maxChunks: 100_000,
  })) {
    requestSignal.throwIfAborted()
    assembler.push(chunk)
  }
  requestSignal.throwIfAborted()
  const error = finishError(assembler.finish)
  if (error !== undefined) throw error
  const blocks = assembler.blocks()
  if (blocks.some((block) => block.type === 'tool-call')) {
    throw new Error('video vision model unexpectedly requested a tool')
  }
  const text = blocks
    .filter((block): block is Extract<(typeof blocks)[number], { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('')
  if (text.length === 0) throw new Error('video vision model produced no text')
  return text
}

function finishError(finish: FinishReason): Error | undefined {
  switch (finish.kind) {
    case 'stop': return undefined
    case 'error':
    case 'aborted': return Object.assign(new Error(finish.failure.message), { code: finish.failure.code })
    case 'max-tokens': return new Error('video vision output reached maxTokens')
    case 'tool-calls': return new Error('video vision model unexpectedly requested a tool')
    default: return new Error(`video vision model returned unsupported finish reason ${String((finish as { kind?: unknown }).kind)}`)
  }
}

function registerIdentityRoute(ctx: Context): void {
  const nonce = process.env.LDD_IDENTITY_NONCE
  if (nonce === undefined || nonce.length < 8 || nonce.length > 256) {
    throw new Error('LDD_IDENTITY_NONCE must contain 8-256 characters')
  }
  const body = JSON.stringify({ product: 'LDD-Harness', nonce, pid: process.pid })
  const route: WebRoute = {
    kind: 'exact',
    path: '/__ldd/identity',
    handler: (req, res) => {
      if (!isLoopbackAddress(req.socket.remoteAddress)) {
        res.writeHead(403, { 'cache-control': 'no-store' })
        res.end()
        return
      }
      if (req.method !== 'GET') {
        res.writeHead(405, { allow: 'GET', 'cache-control': 'no-store' })
        res.end()
        return
      }
      res.writeHead(200, {
        'cache-control': 'no-store',
        'content-length': String(Buffer.byteLength(body, 'utf8')),
        'content-type': 'application/json; charset=utf-8',
      })
      res.end(body)
    },
  }
  ctx.effect(() => ctx.webServer.register(route), 'ldd-video-frame-analyzer identity route')
}

function registerHealthRoute(ctx: Context): void {
  const body = JSON.stringify({
    product: 'LDD-Harness',
    videoToolRegistered: true,
    sessionEventTypeRegistered: KNOWN_SESSION_EVENT_TYPES.has('video/analysis-input'),
    skill: 'video-analysis',
  })
  const route: WebRoute = {
    kind: 'exact',
    path: '/__ldd/health',
    handler: (req, res) => {
      if (!isLoopbackAddress(req.socket.remoteAddress)) {
        res.writeHead(403, { 'cache-control': 'no-store' })
        res.end()
        return
      }
      if (req.method !== 'GET') {
        res.writeHead(405, { allow: 'GET', 'cache-control': 'no-store' })
        res.end()
        return
      }
      res.writeHead(200, {
        'cache-control': 'no-store',
        'content-length': String(Buffer.byteLength(body, 'utf8')),
        'content-type': 'application/json; charset=utf-8',
      })
      res.end(body)
    },
  }
  // Registered after tools.register above: a successful response proves the
  // plugin reached the point after analyze_video registration.
  ctx.effect(() => ctx.webServer.register(route), 'ldd-video-frame-analyzer health route')
}

function isLoopbackAddress(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function imageRefValue(ref: ImageAttachmentRef): VideoImageRef {
  if (ref.mediaType !== 'image/jpeg') throw new Error('contact sheet normalization changed its media type')
  return {
    attachmentId: ref.attachmentId,
    mediaType: 'image/jpeg',
    bytes: ref.bytes,
    width: ref.width,
    height: ref.height,
    ...(ref.name === undefined ? {} : { name: ref.name }),
  }
}

function imageRefFromValue(ref: VideoImageRef): ImageAttachmentRef {
  return {
    attachmentId: AttachmentId(ref.attachmentId),
    mediaType: ref.mediaType,
    bytes: ref.bytes,
    width: ref.width,
    height: ref.height,
    ...(ref.name === undefined ? {} : { name: ref.name }),
  }
}

function validateConfig(config: Config): void {
  for (const [field, value] of [
    ['provider', config.provider],
    ['model', config.model],
  ] as const) {
    if (value.trim().length === 0) throw new Error(`video analyzer ${field} must be non-empty`)
  }
  for (const [field, value] of [
    ['ffmpegPath', config.ffmpegPath],
    ['ffprobePath', config.ffprobePath],
    ['cacheRoot', config.cacheRoot],
  ] as const) {
    if (!isAbsolute(value)) throw new Error(`video analyzer ${field} must be absolute`)
  }
}

export type * from './types.ts'
export { analyzeVideo } from './analyzer.ts'
