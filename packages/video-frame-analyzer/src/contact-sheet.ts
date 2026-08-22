import { extname, join } from 'node:path'

import {
  maxContactSheetsPerAnalysis,
  maxFramesPerAnalysis,
  maxFramesPerContactSheet,
} from './config.ts'

const tileWidth = 512
const tileHeight = 288

export interface PlannedContactSheet {
  readonly index: number
  readonly outputPath: string
  readonly timestamps: readonly number[]
  readonly argv: readonly string[]
}

export function buildContactSheetCommand(
  inputPath: string,
  timestamps: readonly number[],
  outputPath: string,
  jpegQuality = 3,
): string[] {
  const normalized = validateTimestamps(timestamps)
  if (normalized.length === 0 || normalized.length > maxFramesPerContactSheet) {
    throw new Error('a contact sheet must contain between one and nine frames')
  }
  if (!/^\.jpe?g$/i.test(extname(outputPath))) {
    throw new Error('contact sheet output must be a JPEG path')
  }
  if (!Number.isSafeInteger(jpegQuality) || jpegQuality < 2 || jpegQuality > 31) {
    throw new Error('contact sheet JPEG quality must be an integer between 2 and 31')
  }

  const argv = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y']
  for (const timestamp of normalized) {
    argv.push('-ss', timestamp.toFixed(3), '-i', inputPath)
  }
  const filters: string[] = []
  for (const [index, timestamp] of normalized.entries()) {
    filters.push(
      `[${index}:v]select=eq(n\\,0),` +
      `scale=${tileWidth}:${tileHeight}:force_original_aspect_ratio=decrease,` +
      `pad=${tileWidth}:${tileHeight}:(ow-iw)/2:(oh-ih)/2:white,` +
      `drawtext=text='${escapeDrawText(formatTimestamp(timestamp))}':` +
      "x=12:y=h-th-12:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.65," +
      `setpts=PTS-STARTPTS[v${index}]`,
    )
  }
  const inputs = normalized.map((_, index) => `[v${index}]`).join('')
  filters.push(
    `${inputs}concat=n=${normalized.length}:v=1:a=0,` +
    `tile=3x3:nb_frames=${normalized.length}:padding=4:margin=4:color=white[out]`,
  )
  argv.push(
    '-filter_complex',
    filters.join(';'),
    '-map',
    '[out]',
    '-frames:v',
    '1',
    '-q:v',
    String(jpegQuality),
    '-pix_fmt',
    'yuvj420p',
    outputPath,
  )
  return argv
}

export function planContactSheets(
  inputPath: string,
  timestamps: readonly number[],
  taskDirectory: string,
): readonly PlannedContactSheet[] {
  const normalized = validateTimestamps(timestamps)
  if (normalized.length > maxFramesPerAnalysis) {
    throw new Error('contact-sheet planning exceeds the 144 frame limit')
  }
  const planned: PlannedContactSheet[] = []
  for (let offset = 0; offset < normalized.length; offset += maxFramesPerContactSheet) {
    const sheetTimestamps = normalized.slice(offset, offset + maxFramesPerContactSheet)
    const index = planned.length
    const outputPath = join(taskDirectory, `sheet-${String(index + 1).padStart(3, '0')}.jpg`)
    planned.push({
      index,
      outputPath,
      timestamps: sheetTimestamps,
      argv: buildContactSheetCommand(inputPath, sheetTimestamps, outputPath),
    })
  }
  if (planned.length > maxContactSheetsPerAnalysis) {
    throw new Error('contact-sheet planning exceeds the 16 sheet limit')
  }
  return planned
}

function validateTimestamps(timestamps: readonly number[]): number[] {
  const normalized: number[] = []
  let previous = -1
  for (const timestamp of timestamps) {
    if (!Number.isFinite(timestamp) || timestamp < 0) {
      throw new Error('contact-sheet timestamp is invalid')
    }
    const rounded = Math.round(timestamp * 1_000) / 1_000
    if (rounded <= previous) {
      throw new Error('contact-sheet timestamps must be sorted and unique')
    }
    normalized.push(rounded)
    previous = rounded
  }
  return normalized
}

function formatTimestamp(timestamp: number): string {
  const milliseconds = Math.round(timestamp * 1_000)
  const hours = Math.floor(milliseconds / 3_600_000)
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000)
  const seconds = Math.floor((milliseconds % 60_000) / 1_000)
  const remainder = milliseconds % 1_000
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(remainder).padStart(3, '0')}`
}

function escapeDrawText(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll(':', '\\:').replaceAll("'", "\\'")
}
