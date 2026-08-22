const requiredEventType = 'video/analysis-input'

/**
 * Harness 0.1.1 generates a closed persistence vocabulary. LDD owns this
 * extension and registers it before any profile session is opened. The source
 * runtime patch remains the primary path; this registration also lets a
 * registry-installed compatible Harness retain the event without rewriting an
 * installed package after its registry integrity has been verified.
 */
export function registerVideoAnalysisSessionEvent(eventTypes: ReadonlySet<string>): void {
  if (eventTypes.has(requiredEventType)) return
  const candidate = eventTypes as ReadonlySet<string> & { add?: (value: string) => unknown }
  if (typeof candidate.add !== 'function') {
    throw new Error('Harness session event vocabulary cannot register LDD video persistence')
  }
  candidate.add(requiredEventType)
  if (!eventTypes.has(requiredEventType)) {
    throw new Error('Harness session event vocabulary rejected LDD video persistence')
  }
}
