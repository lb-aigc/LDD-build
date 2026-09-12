/**
 * Slot and locale type declarations for the generation cards.
 *
 * A plugin contributing a card into `settings.plugin.item` owns its own copy of
 * the slot's SlotMap declaration (the tab that declares the slot at runtime
 * lives in ui-settings-plugins, which a card author must not depend on). The
 * declaration is identical, so TypeScript merges them. Same for the locale
 * namespace map: `generate` is this package's own dictionary key.
 *
 * `tool.call.toolview` is the SAME story: ui-tool declares the slot and
 * constructs its owner (`ToolCallOwnerProps`), this plugin registers keyed
 * entries (`generate_image` / `generate_video` / `generate_music`) under it.
 * The generate package typechecks STANDALONE (it has no
 * `@deepseek-ai/dsh-client-ui-tool` dependency edge), so it declares its own
 * local copy of the slot and its owner. At runtime the two are the SAME object
 * (ui-tool builds it, this plugin's component reads it) — duck-typed by field
 * name, never by the TS type name.
 */
import type { ImageMeta } from '../attach.ts'
import type { GenerateLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** One plugin's card inside the plugin configuration section. */
    'settings.plugin.item': { kind: 'keyed'; scope: 'root'; owner: SettingsPluginItemOwnerProps }
    /** The composer tool-row generation-model seat (single, session-scoped).
     *  Registered under the dedicated `conversation.input.generate-model` seat
     *  (added by 0005), whose owner share is `{ locked: boolean }`. The stock
     *  `conversation.input.model` seat stays the harness-native LLM selector. */
    'conversation.input.generate-model': { kind: 'single'; scope: 'session'; owner: InputControlOwnerProps }
    /** Keyed atomic Tool-call view. ui-tool declares this slot (kind keyed,
     *  scope session) and dispatches by wire Tool name; this plugin registers
     *  one entry per generate tool so its media result renders inline. */
    'tool.call.toolview': { kind: 'keyed'; scope: 'session'; owner: ToolCallViewOwnerProps }
  }
  interface LocaleNamespaceMap {
    /** The generation-settings card's own copy. */
    generate: GenerateLocaleKey
  }
}

/** Owner share of a plugin card (the section supplies nothing). */
export interface SettingsPluginItemOwnerProps {
  children?: never
}

/** Owner share of a composer input control seat (the bar supplies its lock). */
export interface InputControlOwnerProps {
  locked: boolean
}

/** Session-authorized image loader for a durable attachment reference.
 *  Local structural copy of the harness `MessageImageLoader` (the same
 *  function object ui-tool hands over), so the generate package needs no
 *  `@deepseek-ai/dsh-attachment` / `@deepseek-ai/dsh-client-ui-conversation`
 *  dependency edge. */
export type ImageLoaderLike = ((attachment: ImageMeta) => Promise<string>) & {
  peek?: (attachment: ImageMeta) => string | undefined
}

/** A Tool call in its running or settled form. The toolview only needs to tell
 *  the two apart (`'kind' in block`) and read the settled result `content`. */
export type ToolCallBlockLike =
  | { readonly callId: string; readonly name: string; readonly argsRaw: string; readonly subCalls?: readonly unknown[] }
  | { readonly kind: string; readonly callId: string; readonly content: readonly unknown[]; readonly isError?: boolean }

/** Owner share of the keyed Tool-call view slot. Local structural copy of
 *  ui-tool's `ToolCallOwnerProps` — only the fields this plugin reads. */
export interface ToolCallViewOwnerProps {
  /** Tool call identity, stable across running and settled forms. */
  readonly callId: string
  /** Wire Tool name and keyed dispatch value. */
  readonly toolName: string
  /** Frozen running call or settled result node. */
  readonly block: ToolCallBlockLike
  /** Session workspace root for relative summaries. */
  readonly cwd?: string | undefined
  /** Host account home. */
  readonly home?: string | undefined
  /** Session-authorized image loader for a durable image attachment. */
  readonly loadImage: ImageLoaderLike
  /** Inspect this call in the trajectory view when available. */
  readonly inspect?: (() => void) | undefined
}
