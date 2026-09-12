/**
 * Tool-result renderer for the generate_* tools. Replaces the generic tool row
 * (keyed `tool.call.toolview` entries `generate_image` / `generate_video` /
 * `generate_music`) so a generated image/audio/video renders INLINE in the
 * conversation instead of flattening to JSON text.
 *
 * Image results render as a thumbnail GALLERY (the same interaction the native
 * harness image card has): a lone image renders at a ~240px long-edge tile,
 * several images (Midjourney returns 4) render side-by-side as 64px tiles, and
 * clicking any tile opens a lightbox preview whose overlay carries the
 * download button. Audio/video blocks render a native `<audio>`/`<video>`
 * player plus a download button (their URLs are temporary, so a lightbox does
 * not apply).
 *
 * Self-contained: the generate package typechecks standalone, so every type is
 * a LOCAL structural copy (see slot-contract.ts) — no `@deepseek-ai/
 * dsh-client-ui-tool` or `@deepseek-ai/dsh-attachment` dependency edge, and no
 * `react-dom` import (not a dependency; the lightbox is a fixed overlay, which
 * the tool row's untransformed ancestry does not trap).
 */
import { useEffect, useState } from 'react'
import { IconCloseOutline16, IconDownloadOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
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

/** Fetch a URL's bytes and hand them to the Electron save bridge (audio/video). */
async function downloadBytes(url: string, defaultName: string, kind: 'saveAudio' | 'saveVideo'): Promise<void> {
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

/**
 * Lone-image display box (the harness chat rule): long edge 240px with the
 * aspect ratio clamped to [0.25, 4], never upscaled past the natural size. The
 * crop anchor keeps the informative region of very tall/wide images.
 */
function singleFit(dimensions: { readonly width: number; readonly height: number }): {
  width: number; height: number; objectPosition: string
} {
  const natural = dimensions.width / dimensions.height
  const ratio = Math.min(4, Math.max(0.25, natural))
  const box = ratio >= 1 ? { width: 240, height: 240 / ratio } : { width: 240 * ratio, height: 240 }
  const scale = Math.min(1, dimensions.width / box.width, dimensions.height / box.height)
  return {
    width: Math.max(1, Math.round(box.width * scale)),
    height: Math.max(1, Math.round(box.height * scale)),
    objectPosition: natural < 0.25 ? 'center top' : natural > 4 ? 'left center' : 'center',
  }
}

/** Suggested save filename for a generated image: `image.<ext>` from its media type. */
function downloadNameFor(attachment: ImageMeta): string {
  return `image.${imageExtension(attachment.mediaType)}`
}

/** One gallery tile: a bounded thumbnail that opens the preview overlay. */
function GeneratedThumb({ attachment, loadImage, variant, t }: {
  attachment: ImageMeta
  loadImage: ToolCallViewOwnerProps['loadImage']
  variant: 'single' | 'tile'
  t: Props['t']
}) {
  const [url, setUrl] = useState<string | null>(() => loadImage.peek?.(attachment) ?? null)
  const [error, setError] = useState(false)
  const [open, setOpen] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let live = true
    setError(false)
    setUrl(loadImage.peek?.(attachment) ?? null)
    void loadImage(attachment).then((loaded) => { if (live) setUrl(loaded) }).catch(() => { if (live) setError(true) })
    return () => { live = false }
  }, [attachment, loadImage, attempt])
  if (error) {
    return <button type="button" className={css.error} data-variant={variant} onClick={() => setAttempt(a => a + 1)}>{t('toolview.retry')}</button>
  }
  const fit = variant === 'single' ? singleFit({ width: attachment.width, height: attachment.height }) : undefined
  const label = attachment.name ?? t('toolview.image')
  return (
    <>
      <button
        type="button"
        className={css.frame}
        data-variant={variant}
        style={fit === undefined ? undefined : { width: fit.width, height: fit.height }}
        title={t('toolview.open')}
        aria-label={t('toolview.open')}
        onClick={() => { if (url !== null) setOpen(true) }}
      >
        {url === null
          ? <span className={css.loading}>{t('toolview.loading')}</span>
          : <img src={url} alt={label} style={fit === undefined ? undefined : { objectPosition: fit.objectPosition }} />}
      </button>
      {open && url !== null && (
        <GenerateLightbox
          src={url}
          alt={label}
          downloadName={downloadNameFor(attachment)}
          t={t}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

/** Full-screen preview overlay: the enlarged image plus download and close. */
function GenerateLightbox({ src, alt, downloadName, t, onClose }: {
  src: string
  alt: string
  downloadName: string
  t: Props['t']
  onClose: () => void
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const saveImage = (): void => {
    const saver = bridge?.saveImage
    if (saver === undefined) return
    void (async () => {
      try {
        const response = await fetch(src)
        if (!response.ok) return
        const buffer = await response.arrayBuffer()
        await saver(buffer, downloadName)
      } catch {
        // Save cancelled or failed — leave the preview open, nothing to surface.
      }
    })()
  }

  return (
    <div className={css.backdrop} role="dialog" aria-modal="true" aria-label={t('toolview.open')}>
      <div className={css.mask} aria-hidden="true" onMouseDown={onClose} />
      <img className={css.lightboxImage} src={src} alt={alt} />
      <div className={css.actions}>
        <button type="button" className={css.action} title={t('toolview.download')} aria-label={t('toolview.download')} onClick={saveImage}>
          <IconDownloadOutline16 size={16} />
        </button>
        <button type="button" className={css.action} aria-label={t('toolview.close')} onClick={onClose}>
          <IconCloseOutline16 size={16} />
        </button>
      </div>
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
  const variant = images.length > 1 ? 'tile' : 'single'
  return (
    <div className={css.toolview}>
      {images.length > 0 && (
        <div className={css.gallery}>
          {images.map((img, i) => (
            <GeneratedThumb key={`img-${i}`} attachment={img.attachment} loadImage={loadImage} variant={variant} t={t} />
          ))}
        </div>
      )}
      {videos.map((vid, i) => <GeneratedVideo key={`vid-${i}`} url={vid.url} title={vid.title} t={t} />)}
      {audios.map((aud, i) => <GeneratedAudio key={`aud-${i}`} url={aud.url} title={aud.title} t={t} />)}
      {text.map((tb, i) => <div key={`txt-${i}`} className={css.text}>{tb.text}</div>)}
    </div>
  )
}
