const requiredEventType = 'canvas/state'

/**
 * Harness generates a closed persistence vocabulary at build time. LDD owns the
 * `canvas/state` event type and must register it before any profile session is
 * opened, or a session log that contains it is refused on read ("… unknown to
 * this harness and not marked ignorable") and the GUI reports 历史加载失败.
 *
 * Mirrors `@ldd/dsh-video-frame-analyzer`'s session-compat for
 * `video/analysis-input`. The registration mutates the SAME Set instance the
 * harness itself imported (ESM module-cache singleton), so no path-to-runtime
 * resolution is needed — unlike an out-of-tree loose module.
 */
export function registerCanvasSessionEvent(eventTypes: ReadonlySet<string>): void {
  if (eventTypes.has(requiredEventType)) return
  const candidate = eventTypes as ReadonlySet<string> & { add?: (value: string) => unknown }
  if (typeof candidate.add !== 'function') {
    throw new Error('Harness session event vocabulary cannot register LDD canvas persistence')
  }
  candidate.add(requiredEventType)
  if (!eventTypes.has(requiredEventType)) {
    throw new Error('Harness session event vocabulary rejected LDD canvas persistence')
  }
}
