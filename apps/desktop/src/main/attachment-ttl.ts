import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Generated-image retention. Generated images are downloaded and stored in the
 * harness attachment library as soon as they are produced (KIE result URLs
 * expire after ~20 minutes, so the bytes must land locally immediately). This
 * sweeper deletes those stored images once they are older than {@link ATTACHMENT_TTL_MS},
 * so the disk does not accumulate images the user never explicitly saved.
 *
 * A user "saves" an image by downloading it (which copies the bytes elsewhere);
 * every stored copy is a disposable cache. Deleting a stored object makes the
 * corresponding chat preview stop rendering after the TTL — the intended
 * "images expire after 48h unless you saved them" behaviour.
 */

/** How long a generated image remains available before the sweeper removes it. */
export const ATTACHMENT_TTL_MS = 48 * 60 * 60 * 1000

/** How often the sweeper runs while the app is open. */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000

/** Recursively delete files whose mtime predates `cutoff`, then prune emptied
 *  directories. Returns the number of files removed. */
async function pruneTree(root: string, cutoff: number): Promise<number> {
  let removed = 0
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return 0 // directory missing — nothing to prune
  }
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      removed += await pruneTree(path, cutoff)
      // Best-effort: remove the directory if the sweep just emptied it.
      try {
        if ((await readdir(path)).length === 0) await rm(path)
      } catch {
        // ignore — non-empty or already gone
      }
    } else if (entry.isFile()) {
      try {
        const info = await stat(path)
        if (info.mtimeMs < cutoff) {
          await rm(path)
          removed += 1
        }
      } catch {
        // ignore — raced deletion
      }
    }
  }
  return removed
}

/** Delete stored images and their model-request cache older than `ttlMs`. */
export async function pruneExpiredAttachments(dshHome: string, ttlMs = ATTACHMENT_TTL_MS): Promise<number> {
  const root = join(dshHome, 'attachments', 'v1')
  const cutoff = Date.now() - ttlMs
  let removed = 0
  for (const sub of ['objects', 'request-images']) {
    removed += await pruneTree(join(root, sub), cutoff)
  }
  return removed
}

/** Start a periodic sweeper: once immediately, then every hour. The interval is
 *  unref'd so it never blocks app exit. Returns a disposer. */
export function startAttachmentTtlSweeper(dshHome: string): () => void {
  let disposed = false
  const sweep = (): void => {
    if (disposed) return
    void pruneExpiredAttachments(dshHome)
      .then((removed) => {
        if (removed > 0) console.log(`[LDD] 清理了 ${removed} 个过期附件（超过 48h）`)
      })
      .catch(() => undefined)
  }
  sweep()
  const timer = setInterval(sweep, SWEEP_INTERVAL_MS)
  timer.unref()
  return () => {
    disposed = true
    clearInterval(timer)
  }
}
