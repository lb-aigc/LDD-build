/**
 * Slot and locale type declarations for the generation cards.
 *
 * A plugin contributing a card into `settings.plugin.item` owns its own copy of
 * the slot's SlotMap declaration (the tab that declares the slot at runtime
 * lives in ui-settings-plugins, which a card author must not depend on). The
 * declaration is identical, so TypeScript merges them. Same for the locale
 * namespace map: `generate` is this package's own dictionary key.
 */
import type { GenerateLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** One plugin's card inside the plugin configuration section. */
    'settings.plugin.item': { kind: 'keyed'; scope: 'root'; owner: SettingsPluginItemOwnerProps }
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
