/**
 * Tool-result renderer for the generate_* tools. Replaces the generic tool row
 * (keyed `tool.call.toolview` entries `generate_image` / `generate_video` /
 * `generate_music`) so a generated image/audio/video renders INLINE in the
 * conversation instead of flattening to JSON text.
 *
 * Each media block renders a native player/thumbnail plus a download button
 * that goes through the Electron `window.ldd.save*` bridge (a plain browser
 * degrades to a no-op). Image blocks resolve through the session-authorized
 * `loadImage` loader (durable attachment → blob URL); audio/video blocks carry
 * a direct temporary URL and stream straight into `<audio>`/`<video>`.
 *
 * Self-contained: the generate package typechecks standalone, so every type is
 * a LOCAL structural copy (see slot-contract.ts) — no `@deepseek-ai/
 * dsh-client-ui-tool` or `@deepseek-ai/dsh-attachment` dependency edge.
 */
import { useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ImageMeta } from '../attach.ts'
import type { ToolCallViewOwnerProps } from './slot-contract.ts'
import css from './GenerateToolView.module.css'

type Props = PropsRuntime<'tool.call.toolview'> & PropsLocale<'generate'>

/** Media block shapes the generate tools emit (merge-extensible at runtime). */
type MediaBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; attachment: ImageMeta }
  | { type: 'audio'; url: string; title: string; durationSeconds: number }
  | { type: 'video'; url: string; title: string; durationSeconds: number }

/** Local structural face of the Electron save bridge (apps/desktop). */
interface LddSaveBridge {
  saveImage?: (data: ArrayBuffer, defaultName: string) => Promise<{ saved: boolean; path?: string }>
  saveAudio?: (data: ArrayBuffer, defaultName: string) => Promise<{ saved: boolean; path?: string }>
  saveVideo?: (data: ArrayBuffer, defaultName: string) => Promise<{ saved: boolean; path?: string }>
}

const bridge = (window as { ldd?: LddSaveBridge }).ldd

/** Derive a download extension from an image media type. */
function imageExtension(mediaType: string): string {
  switch (mediaType) {
    case 'image/png': return 'png'
    case 'image/jpeg': return 'jpg'
    case 'image/webp': return 'webp'
    case 'image/gif': return 'gif'
    default: return 'png'
  }
}

/** Fetch a URL's bytes and hand them to the Electron save bridge. */
async function downloadBytes(url: string, defaultName: string, kind: 'saveImage' | 'saveAudio' | 'saveVideo'): Promise<void> {
  const fn = bridge?.[kind]
  if (fn === undefined) return
  try {
    const response = await fetch(url)
    if (!response.ok) return
    const data = await response.arrayBuffer()
    await fn(data, defaultName)
  } catch {
    // Cross-origin / expired temporary URL: the inline player already failed,
    // so a failed download is non-fatal here.
  }
}

/** Inline image: load the durable attachment, then render a thumbnail + download. */
function GeneratedImage({ attachment, loadImage, t }: {
  attachment: ImageMeta
  loadImage: ToolCallViewOwnerProps['loadImage']
  t: Props['t']
}) {
  const [url, setUrl] = useState<string | null>(() => loadImage.peek?.(attachment) ?? null)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let live = true
    setError(false)
    setUrl(loadImage.peek?.(attachment) ?? null)
    void loadImage(attachment).then((loaded) => { if (live) setUrl(loaded) }).catch(() => { if (live) setError(true) })
    return () => { live = false }
  }, [attachment, loadImage, attempt])
  if (error) {
    return <button type="button" className={css.error} onClick={() => setAttempt(a => a + 1)}>{t('toolview.retry')}</button>
  }
  if (url === null) return <div className={css.loading}>{t('toolview.loading')}</div>
  return (
    <div className={css.mediaBlock}>
      <img className={css.image} src={url} alt={attachment.name ?? 'image'} />
      <button type="button" className={css.download} onClick={() => {
        const ext = imageExtension(attachment.mediaType)
        void downloadBytes(url, `${attachment.name ?? 'image'}.${ext}`, 'saveImage')
      }}>{t('toolview.download')}</button>
    </div>
  )
}

/** Inline audio: native player + download. */
function GeneratedAudio({ url, title, t }: { url: string; title: string; t: Props['t'] }) {
  return (
    <div className={css.mediaBlock}>
      <audio className={css.audio} controls src={url} />
      <button type="button" className={css.download} onClick={() => {
        void downloadBytes(url, `${title}.mp3`, 'saveAudio')
      }}>{t('toolview.download')}</button>
    </div>
  )
}

/** Inline video: native player + download. */
function GeneratedVideo({ url, title, t }: { url: string; title: string; t: Props['t'] }) {
  return (
    <div className={css.mediaBlock}>
      <video className={css.video} controls src={url} />
      <button type="button" className={css.download} onClick={() => {
        void downloadBytes(url, `${title}.mp4`, 'saveVideo')
      }}>{t('toolview.download')}</button>
    </div>
  )
}

/** Whole generate_* result: media blocks inline, text blocks below. */
export function GenerateToolView({ block, loadImage, t }: Props) {
  const settled = 'kind' in block
  if (!settled) return <div className={css.running}>{t('toolview.generating')}</div>
  const blocks = block.content as unknown as MediaBlock[]
  const text = blocks.filter((b): b is { type: 'text'; text: string } => b.type === 'text')
  const images = blocks.filter((b): b is { type: 'image'; attachment: ImageMeta } => b.type === 'image')
  const audios = blocks.filter((b): b is { type: 'audio'; url: string; title: string; durationSeconds: number } => b.type === 'audio')
  const videos = blocks.filter((b): b is { type: 'video'; url: string; title: string; durationSeconds: number } => b.type === 'video')
  return (
    <div className={css.toolview}>
      {images.map((img, i) => <GeneratedImage key={`img-${i}`} attachment={img.attachment} loadImage={loadImage} t={t} />)}
      {videos.map((vid, i) => <GeneratedVideo key={`vid-${i}`} url={vid.url} title={vid.title} t={t} />)}
      {audios.map((aud, i) => <GeneratedAudio key={`aud-${i}`} url={aud.url} title={aud.title} t={t} />)}
      {text.map((tb, i) => <div key={`txt-${i}`} className={css.text}>{tb.text}</div>)}
    </div>
  )
}
