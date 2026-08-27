/**
 * LDD glass theme — injected by the Electron shell into the harness page as a
 * <style id="ldd-glass-theme"> appended to <head>.
 *
 * This is an IN-APP frosted gradient (no system material). The window is a
 * plain native window; the body paints a neutral cool-grey colour-field
 * backdrop, and the main surfaces sit translucent on top so the colour blobs
 * show through as a soft frosted depth.
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
export const GLASS_THEME_CSS = `
/* ================= LDD glass theme ================= */

/* ---- light theme: neutral cool-grey colour-field backdrop + translucent
   white surfaces (subtle frost, not warm) ---- */
html,
body {
  /* neutral cool-grey blobs — visible shape, neutral hue, restrained alpha */
  background:
    radial-gradient(420px 420px at 12% 8%, rgba(198, 204, 214, 0.40), transparent 70%),
    radial-gradient(360px 360px at 88% 22%, rgba(160, 168, 178, 0.36), transparent 70%),
    radial-gradient(400px 400px at 78% 86%, rgba(184, 192, 202, 0.38), transparent 72%),
    radial-gradient(320px 320px at 18% 78%, rgba(148, 156, 166, 0.34), transparent 70%),
    radial-gradient(300px 300px at 50% 38%, rgba(212, 218, 224, 0.38), transparent 70%),
    linear-gradient(160deg, #e6e7ea 0%, #d6d8dc 55%, #c4c6cb 100%) !important;
}

body {
  /* translucent white fills */
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

/* ---- dark theme: grey-black backdrop, translucent dark surfaces ---- */
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

/* ---- composer card: hairline top highlight + soft drop shadow ---- */
[data-composer-card] {
  box-shadow:
    inset 0 1px 0 var(--ldd-edge),
    var(--ldd-shadow);
}
`
