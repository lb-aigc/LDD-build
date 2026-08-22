import { stat } from 'node:fs/promises'

import { buildContactSheetCommand } from './contact-sheet.ts'
import type { PlannedContactSheet } from './contact-sheet.ts'
import type { VideoRange } from './sampling.ts'
import { runManagedSubprocess, type SubprocessSpawner } from './subprocess-runner.ts'
import type { TempMediaContext } from './temp-media.ts'

const maxFfmpegOutputBytes = 4 * 1024 * 1024
const maxJpegBytesPerFrame = 500 * 1024
const jpegQualityAttempts = [3, 7, 11, 15] as const

export interface VideoMediaRuntimeConfig {
  readonly ffmpegPath: string
  readonly sceneThreshold: number
  readonly stopGraceMs: number
}

export class VideoMediaRuntime {
  readonly #config: VideoMediaRuntimeConfig
  readonly #subprocess: SubprocessSpawner
  readonly #decodeWarnings = new WeakMap<TempMediaContext, string[]>()

  constructor(config: VideoMediaRuntimeConfig, subprocess: SubprocessSpawner) {
    if (!Number.isFinite(config.sceneThreshold) || config.sceneThreshold <= 0 || config.sceneThreshold >= 1) {
      throw new Error('video sceneThreshold must be between 0 and 1')
    }
    if (!Number.isSafeInteger(config.stopGraceMs) || config.stopGraceMs <= 0) {
      throw new Error('stopGraceMs must be a positive integer')
    }
    this.#config = config
    this.#subprocess = subprocess
  }

  async detectScenes(
    inputPath: string,
    range: Required<VideoRange>,
    media: TempMediaContext,
  ): Promise<readonly number[]> {
    const duration = range.endSeconds - range.startSeconds
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('video scene range is invalid')
    const filter = `setpts=PTS-STARTPTS,select=gt(scene\\,${this.#config.sceneThreshold}),metadata=print:file=pipe\\:1`
    const output = await this.#run([
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-ss',
      String(range.startSeconds),
      '-i',
      inputPath,
      '-t',
      String(duration),
      '-an',
      '-vf',
      filter,
      '-f',
      'null',
      '-',
    ], media)
    return parseSceneTimestamps(output.stdout)
      .map((timestamp) => Math.round((timestamp + range.startSeconds) * 1_000) / 1_000)
      .filter((timestamp) => timestamp >= range.startSeconds && timestamp < range.endSeconds)
  }

  async renderContactSheet(
    plan: PlannedContactSheet,
    media: TempMediaContext,
  ): Promise<void> {
    const maximumBytes = plan.timestamps.length * maxJpegBytesPerFrame
    for (const [index, quality] of jpegQualityAttempts.entries()) {
      const argv = index === 0
        ? plan.argv
        : buildContactSheetCommand(
          inputPathFromContactSheetCommand(plan.argv),
          plan.timestamps,
          plan.outputPath,
          quality,
        )
      await this.#run(argv, media)
      const metadata = await stat(plan.outputPath)
      if (!metadata.isFile()) throw new Error('FFmpeg contact sheet output is not a regular file')
      if (metadata.size <= maximumBytes) return
    }
    throw new Error(`contact sheet exceeds the ${String(maxJpegBytesPerFrame)} byte-per-frame limit`)
  }

  decodeWarnings(media: TempMediaContext): readonly string[] {
    return [...(this.#decodeWarnings.get(media) ?? [])]
  }

  async #run(argv: readonly string[], media: TempMediaContext): Promise<{ readonly stdout: string; readonly stderr: string }> {
    media.signal.throwIfAborted()
    const result = await runManagedSubprocess(
      this.#subprocess,
      this.#config.ffmpegPath,
      argv,
      media.path,
      media.signal,
      {
        maxOutputBytes: maxFfmpegOutputBytes,
        graceMs: this.#config.stopGraceMs,
        trackChild: (child) => media.trackChild(child),
      },
    )
    this.#recordDecodeWarnings(media, result.stderr)
    return result
  }

  #recordDecodeWarnings(media: TempMediaContext, stderr: string): void {
    const current = this.#decodeWarnings.get(media) ?? []
    for (const line of stderr.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean)) {
      const bounded = line.slice(0, 1_000)
      if (!current.includes(bounded)) current.push(bounded)
      if (current.length >= 64) break
    }
    this.#decodeWarnings.set(media, current)
  }
}

function inputPathFromContactSheetCommand(argv: readonly string[]): string {
  const index = argv.indexOf('-i')
  const input = index === -1 ? undefined : argv[index + 1]
  if (input === undefined) throw new Error('contact sheet command does not contain an input path')
  return input
}

export function parseSceneTimestamps(output: string): number[] {
  if (Buffer.byteLength(output, 'utf8') > maxFfmpegOutputBytes) {
    throw new Error('FFmpeg scene metadata exceeds the safety limit')
  }
  const timestamps = new Set<number>()
  for (const match of output.matchAll(/\bpts_time:([0-9]+(?:\.[0-9]+)?)/gu)) {
    const value = Number(match[1])
    if (!Number.isFinite(value) || value < 0 || value > 24 * 60 * 60) continue
    timestamps.add(Math.round(value * 1_000) / 1_000)
  }
  return [...timestamps].sort((left, right) => left - right)
}
