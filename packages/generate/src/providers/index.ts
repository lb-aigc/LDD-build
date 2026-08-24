import type { GenerationProvider, ProviderOptions } from '../provider.ts'
import { MockGenerationProvider } from '../provider.ts'
import type { ProviderProtocol } from '../presets.ts'
import { PROVIDER_PROTOCOLS } from '../presets.ts'
import { OpenAICompatibleProvider } from './openai-compatible.ts'
import { GeminiImageProvider } from './gemini.ts'
import { MidjourneyProvider } from './midjourney.ts'
import { VolcengineProvider } from './volcengine.ts'

/**
 * Protocol → adapter factory. A preset (or a custom selection) resolves to one
 * of these protocols, which constructs the concrete adapter. The mock protocol
 * ignores {@link options}; every other protocol reads them.
 */
export function createProvider(
  protocol: ProviderProtocol | string,
  options: ProviderOptions,
): GenerationProvider {
  switch (protocol) {
    case 'mock':
      return new MockGenerationProvider()
    case 'openai-compatible':
      return new OpenAICompatibleProvider(options)
    case 'gemini':
      return new GeminiImageProvider(options)
    case 'midjourney':
      return new MidjourneyProvider(options)
    case 'volcengine':
      return new VolcengineProvider(options)
    default:
      throw new Error(
        `unknown generation protocol "${protocol}" (available: ${PROVIDER_PROTOCOLS.join(', ')})`,
      )
  }
}
