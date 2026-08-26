/**
 * LDD glass theme — injected by the Electron shell into the harness page as a
 * <style id="ldd-glass-theme"> appended to <head>. Neutral warm-grey "liquid
 * glass": translucent white surfaces over a warm grey/brown-tone colour-field
 * backdrop. No cyan, no purple.
 *
 * WHY THE BACKDROP MUST BE COLOURFUL, NOT FLAT GREY (the real lesson):
 * "Frosted glass" reads as frosted ONLY when the translucent panel shows a
 * BLURRED, SHAPED, COLOURED field through it. A flat grey gradient, blurred,
 * is still flat grey — so the panel reads as a solid sheet, not glass. The
 * backdrop therefore paints strong warm-blob gradients (alpha 0.5-0.75) that
 * the translucent white panels visibly soften and wash out, which is exactly
 * the frosted depth the user asked for.
 *
 * HARD-WON RULES (each caused an on-device bug — do not reintroduce):
 * 1. NEVER put `backdrop-filter` on the frame / sidebar / details column (or
 *    any container that can hold a `position: fixed`/`absolute` overlay
 *    descendant): it creates a containing block and breaks the settings modal's
 *    overlay — the panel gets trapped in the narrow sidebar column and its text
 *    renders VERTICALLY (the "settings page shows vertical text" bug).
 * 2. ONLY the MAIN surfaces go translucent: `--dsw-alias-bg-base` (conversation
 *    column), `--dsw-specific-sidebar-fill`, `--dsw-specific-input-major`
 *    (composer card). Do NOT touch `--dsw-alias-bg-layer-1/2/3`,
 *    `--dsw-alias-bg-overlay`, `--dsw-specific-menu`, etc. — those paint the
 *    settings modal / menus / popovers, which need OPAQUE, high-contrast
 *    surfaces (a translucent modal shows the page through it and looks broken).
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
  /* translucent white fills — translucent enough for the warm blobs to show */
  --ldd-fill-base: rgba(255, 255, 255, 0.28);
  --ldd-fill-sidebar: rgba(250, 250, 252, 0.30);
  --ldd-fill-input: rgba(255, 255, 255, 0.50);
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
  --ldd-fill-base: rgba(22, 22, 26, 0.60);
  --ldd-fill-sidebar: rgba(28, 28, 32, 0.62);
  --ldd-fill-input: rgba(32, 32, 37, 0.62);
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

/* ---- composer card: hairline top highlight + soft drop shadow. No
   backdrop-filter (a leaf's dropdown/tooltip can still be fixed-positioned). */
[data-composer-card] {
  box-shadow:
    inset 0 1px 0 var(--ldd-edge),
    var(--ldd-shadow);
}
`
