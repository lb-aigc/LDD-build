/**
 * LDD glass theme — injected by the Electron shell into the harness page as a
 * <style id="ldd-glass-theme"> appended to <head>.
 *
 * Two variants (the shell picks based on the OS):
 *  - GLASS_THEME_CSS (Windows 11): the body is TRANSPARENT so the system
 *    acrylic material (window `backgroundMaterial: 'acrylic'`) shows through —
 *    the real "blurred desktop behind the window" effect. The translucent
 *    white panels then sit on top of the acrylic.
 *  - GLASS_THEME_FALLBACK_CSS (Windows 10): the body paints a neutral
 *    cool-grey gradient backdrop, because Win10 has no acrylic and a
 *    transparent body would render black.
 *
 * HARD-WON RULES (each caused an on-device bug — do not reintroduce):
 * 1. NEVER put backdrop-filter on the frame / sidebar / details column (or any
 *    container that can hold a fixed/absolute overlay descendant): it creates a
 *    containing block and breaks the settings modal's overlay — the panel gets
 *    trapped in the narrow sidebar column and its text renders VERTICALLY (the
 *    "settings page shows vertical text" bug).
 * 2. ONLY the MAIN surfaces go translucent: --dsw-alias-bg-base (conversation
 *    column), --dsw-specific-sidebar-fill, --dsw-specific-input-major
 *    (composer card). Do NOT touch --dsw-alias-bg-layer-1/2/3,
 *    --dsw-alias-bg-overlay, --dsw-specific-menu — those paint the settings
 *    modal / menus / popovers, which need OPAQUE, high-contrast surfaces.
 */

/* Translucent surface tokens shared by both variants. */
const SURFACE_CSS = `
/* ---- translucent surface tokens ---- */
body {
  --ldd-fill-base: rgba(255, 255, 255, 0.30);
  --ldd-fill-sidebar: rgba(250, 250, 252, 0.32);
  --ldd-fill-input: rgba(255, 255, 255, 0.52);
  --ldd-edge: rgba(255, 255, 255, 0.60);
  --ldd-edge-soft: rgba(0, 0, 0, 0.10);
  --ldd-shadow: 0 8px 32px rgba(60, 62, 68, 0.20);

  --dsw-alias-bg-base: var(--ldd-fill-base);
  --dsw-specific-sidebar-fill: var(--ldd-fill-sidebar);
  --dsw-specific-input-major: var(--ldd-fill-input);
  --dsw-alias-border-l1: var(--ldd-edge-soft);
}

body[data-ds-dark-theme] {
  --ldd-fill-base: rgba(22, 22, 26, 0.55);
  --ldd-fill-sidebar: rgba(28, 28, 32, 0.58);
  --ldd-fill-input: rgba(32, 32, 37, 0.60);
  --ldd-edge: rgba(255, 255, 255, 0.16);
  --ldd-edge-soft: rgba(255, 255, 255, 0.08);
  --ldd-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);

  --dsw-alias-bg-base: var(--ldd-fill-base);
  --dsw-specific-sidebar-fill: var(--ldd-fill-sidebar);
  --dsw-specific-input-major: var(--ldd-fill-input);
  --dsw-alias-border-l1: var(--ldd-edge-soft);
}

/* ---- composer card: hairline top highlight + soft drop shadow ---- */
[data-composer-card] {
  box-shadow:
    inset 0 1px 0 var(--ldd-edge),
    var(--ldd-shadow);
}
`

/** Windows 11: transparent body so the acrylic material shows through. */
export const GLASS_THEME_CSS = `
/* ================= LDD glass theme (Windows 11 acrylic) ================= */
html,
body {
  background: transparent !important;
}
${SURFACE_CSS}
`

/** Windows 10 fallback: paint our own neutral cool-grey gradient backdrop. */
export const GLASS_THEME_FALLBACK_CSS = `
/* ================= LDD glass theme (Windows 10 fallback) ================= */
html,
body {
  background:
    radial-gradient(420px 420px at 12% 8%, rgba(198, 204, 214, 0.40), transparent 70%),
    radial-gradient(360px 360px at 88% 22%, rgba(160, 168, 178, 0.36), transparent 70%),
    radial-gradient(400px 400px at 78% 86%, rgba(184, 192, 202, 0.38), transparent 72%),
    radial-gradient(320px 320px at 18% 78%, rgba(148, 156, 166, 0.34), transparent 70%),
    radial-gradient(300px 300px at 50% 38%, rgba(212, 218, 224, 0.38), transparent 70%),
    linear-gradient(160deg, #e6e7ea 0%, #d6d8dc 55%, #c4c6cb 100%) !important;
}

html:has(body[data-ds-dark-theme]),
body[data-ds-dark-theme] {
  background:
    radial-gradient(440px 440px at 12% 8%, rgba(70, 74, 84, 0.45), transparent 70%),
    radial-gradient(360px 360px at 88% 22%, rgba(52, 56, 64, 0.40), transparent 70%),
    radial-gradient(400px 400px at 78% 86%, rgba(60, 64, 72, 0.38), transparent 72%),
    radial-gradient(320px 320px at 18% 78%, rgba(46, 50, 58, 0.36), transparent 70%),
    radial-gradient(300px 300px at 50% 38%, rgba(66, 70, 78, 0.38), transparent 70%),
    linear-gradient(160deg, #1e1e22 0%, #17171a 55%, #111114 100%) !important;
}
${SURFACE_CSS}
`
