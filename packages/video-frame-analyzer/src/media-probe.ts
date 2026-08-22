import { lstat, realpath } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'

import {
  maxVideoFileBytes,
  supportedVideoFormats,
  type VideoFormat,
} from './config.ts'

const maxProbeOutputBytes = 2 * 1024 * 1024
const supportedFormatNames: Readonly<Record<VideoFormat, readonly string[]>> = Object.freeze({
  mp4: ['mov', 'mp4'],
  mov: ['mov', 'mp4'],
  mkv: ['matroska'],
  webm: ['matroska', 'webm'],
})

export interface VideoMetadata {
  readonly durationSeconds: number
  readonly width: number
  readonly height: number
  readonly frameRate: number
  readonly hasAudio: boolean
  readonly format: VideoFormat
}

export interface ProbeRunResult {
  readonly stdout: string
}

export type ProbeRunner = (
  executable: string,
  argv: readonly string[],
  signal: AbortSignal,
) => Promise<ProbeRunResult>

export async function authorizeVideoPath(
  inputPath: string,
  workspaceRoot: string,
): Promise<string> {
  if (!isAbsolute(inputPath) || !isAbsolute(workspaceRoot)) {
    throw new TypeError('video and workspace paths must be absolute')
  }
  const [workspaceRealPath, inputMetadata] = await Promise.all([
    realpath(workspaceRoot),
    lstat(inputPath),
  ])
  if (inputMetadata.isSymbolicLink() || !inputMetadata.isFile()) {
    throw new Error('video path must be a regular non-link file')
  }
  if (inputMetadata.size > maxVideoFileBytes) {
    throw new Error('video file exceeds the 2 GiB limit')
  }
  const inputRealPath = await realpath(inputPath)
  if (!isInside(workspaceRealPath, inputRealPath)) {
    throw new Error('video path is outside the authorized workspace')
  }
  parseVideoFormat(inputRealPath)
  return inputRealPath
}

export async function probeVideo(
  authorizedPath: string,
  ffprobePath: string,
  signal: AbortSignal,
  runner: ProbeRunner,
): Promise<VideoMetadata> {
  if (!isAbsolute(authorizedPath) || !isAbsolute(ffprobePath)) {
    throw new TypeError('probe paths must be absolute')
  }
  const result = await runner(
    ffprobePath,
    [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      authorizedPath,
    ],
    signal,
  )
  if (Buffer.byteLength(result.stdout, 'utf8') > maxProbeOutputBytes) {
    throw new Error('ffprobe output exceeds the safety limit')
  }
  return parseFfprobeOutput(result.stdout, authorizedPath)
}

export function parseFfprobeOutput(serialized: string, inputPath: string): VideoMetadata {
  let decoded: unknown
  try {
    decoded = JSON.parse(serialized) as unknown
  } catch {
    throw new Error('ffprobe returned malformed JSON')
  }
  const root = requireRecord(decoded, 'ffprobe output')
  const streams = requireArray(root.streams, 'ffprobe streams')
  const video = streams
    .map((stream, index) => requireRecord(stream, `ffprobe streams[${index}]`))
    .find((stream) => stream.codec_type === 'video')
  if (video === undefined) throw new Error('ffprobe reported no video stream')
  const formatRecord = requireRecord(root.format, 'ffprobe format')
  const format = parseVideoFormat(inputPath)
  assertContainerIdentity(formatRecord.format_name, format)

  const durationSeconds = parsePositiveNumber(
    video.duration ?? formatRecord.duration,
    'video duration',
    24 * 60 * 60,
  )
  const width = parsePositiveInteger(video.width, 'video width', 32_768)
  const height = parsePositiveInteger(video.height, 'video height', 32_768)
  if (width * height > 268_435_456) {
    throw new Error('video dimensions exceed the pixel safety limit')
  }
  const frameRate = parseFrameRate(video.avg_frame_rate ?? video.r_frame_rate)
  const hasAudio = streams.some((stream) =>
    typeof stream === 'object' && stream !== null && !Array.isArray(stream) &&
    (stream as Record<string, unknown>).codec_type === 'audio',
  )
  return { durationSeconds, width, height, frameRate, hasAudio, format }
}

function parseVideoFormat(inputPath: string): VideoFormat {
  const extension = extname(inputPath).slice(1).toLowerCase()
  if (!(supportedVideoFormats as readonly string[]).includes(extension)) {
    throw new Error(`unsupported video format: ${extension || '(none)'}`)
  }
  return extension as VideoFormat
}

function assertContainerIdentity(rawFormatName: unknown, format: VideoFormat): void {
  if (typeof rawFormatName !== 'string') {
    throw new Error('ffprobe format name is missing')
  }
  const names = new Set(rawFormatName.split(',').map((name) => name.trim().toLowerCase()))
  if (!supportedFormatNames[format].some((name) => names.has(name))) {
    throw new Error(`ffprobe container does not match the .${format} extension`)
  }
}

function parsePositiveNumber(value: unknown, field: string, maximum: number): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > maximum) {
    throw new Error(`${field} is invalid`)
  }
  return parsed
}

function parsePositiveInteger(value: unknown, field: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0 || (value as number) > maximum) {
    throw new Error(`${field} is invalid`)
  }
  return value as number
}

function parseFrameRate(value: unknown): number {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error('video frame rate is invalid')
  }
  if (typeof value === 'number') return parsePositiveNumber(value, 'video frame rate', 1_000)
  const rational = /^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(value)
  if (rational !== null) {
    const numerator = Number(rational[1])
    const denominator = Number(rational[2])
    return parsePositiveNumber(numerator / denominator, 'video frame rate', 1_000)
  }
  return parsePositiveNumber(value, 'video frame rate', 1_000)
}

function isInside(root: string, candidate: string): boolean {
  const pathFromRoot = relative(resolve(root), resolve(candidate))
  const normalized = process.platform === 'win32' ? pathFromRoot.toLowerCase() : pathFromRoot
  return normalized === '' || (!normalized.startsWith(`..${sep}`) && normalized !== '..' && !isAbsolute(normalized))
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be an object`)
  }
  return value as Record<string, unknown>
}

function requireArray(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`)
  return value
}
