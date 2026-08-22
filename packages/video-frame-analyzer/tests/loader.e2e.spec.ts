import Loader from '@deepseek-ai/cordis-plugin-loader'
import { describe, expect, it } from 'vitest'

import * as videoAnalyzer from '../src/index.ts'

describe('real Cordis Loader export composition', () => {
  it('retains the named plugin contract without a default-export collapse', () => {
    expect('default' in videoAnalyzer).toBe(false)

    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(videoAnalyzer) as Record<string, unknown>

    expect(unwrapped).toBe(videoAnalyzer)
    expect(unwrapped.name).toBe('ldd-video-frame-analyzer')
    expect(unwrapped.inject).toEqual(['tools', 'attachments', 'fs', 'llm', 'webServer', 'subprocess'])
    expect(unwrapped.Config).toBeDefined()
    expect(typeof unwrapped.apply).toBe('function')
  })
})
