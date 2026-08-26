/**
 * LDD glass theme — injected by the Electron shell into the harness page as a
 * <style id="ldd-glass-theme"> appended to <head>. Neutral grey "liquid glass".
 *
 * HARD-WON RULES (each caused an on-device bug — do not reintroduce):
 * 1. NEVER put `backdrop-filter` on the frame / sidebar / details column (or
 *    any container that can hold a `position: fixed`/`absolute` overlay
 *    descendant): it creates a containing block and breaks the settings modal's
 *    overlay — the panel gets trapped in the narrow sidebar column and its text
 *    renders VERTICALLY (the "settings page shows vertical text" bug).
 *    Instead, the frosted depth comes from a `body::before` layer that is
 *    BLURRED WITH `filter` (not backdrop-filter) — `filter: blur()` blurs the
 *    layer itself, so it never touches the overlay descendants' containing
 *    block.
 * 2. ONLY the MAIN surfaces go translucent: `--dsw-alias-bg-base` (conversation
 *    column), `--dsw-specific-sidebar-fill`, `--dsw-specific-input-major`
 *    (composer card). Do NOT touch `--dsw-alias-bg-layer-1/2/3`,
 *    `--dsw-alias-bg-overlay`, `--dsw-specific-menu`, etc. — those paint the
 *    settings modal / menus / popovers, which need OPAQUE, high-contrast
 *    surfaces (a translucent modal shows the page through it and looks broken).
 * 3. The LIGHT theme must use GREY-tone halos + a grey gradient backdrop, NOT
 *    white-on-white: a translucent white panel over a white/grey-less backdrop
 *    reads as a flat white sheet with zero glass depth. The grey backdrop is
 *    what the white panels "show through", so it needs visible grey steps.
 */
export const GLASS_THEME_CSS = `
/* ================= LDD glass theme ================= */

/* ---- light theme: grey backdrop (blurred body::before layer), translucent
   white surfaces ---- */
body {
  position: relative;
  z-index: 0;
  /* flat fallback colour (the ::before layer paints the visible backdrop) */
  background: #d4d4da;

  /* translucent white fills — MORE transparent so the backdrop really shows */
  --ldd-fill-base: rgba(255, 255, 255, 0.30);
  --ldd-fill-sidebar: rgba(250, 250, 252, 0.34);
  --ldd-fill-input: rgba(255, 255, 255, 0.52);
  --ldd-edge: rgba(255, 255, 255, 0.60);
  --ldd-edge-soft: rgba(0, 0, 0, 0.10);
  --ldd-shadow: 0 8px 32px rgba(60, 62, 68, 0.20);

  --dsw-alias-bg-base: var(--ldd-fill-base);
  --dsw-specific-sidebar-fill: var(--ldd-fill-sidebar);
  --dsw-specific-input-major: var(--ldd-fill-input);
  --dsw-alias-border-l1: var(--ldd-edge-soft);
}

/* The frosted backdrop: crisp colour blobs blurred with `filter`, so the
   translucent panels above show a soft, out-of-focus colour field through them
   (the "磨砂" depth) WITHOUT any backdrop-filter containing-block hazard. */
body::before {
  content: '';
  position: fixed;
  inset: -120px;
  z-index: -1;
  pointer-events: none;
  background:
    radial-gradient(260px 260px at 78% 12%, rgba(120, 124, 132, 0.60), transparent 70%),
    radial-gradient(220px 220px at 14% 28%, rgba(138, 132, 124, 0.55), transparent 70%),
    radial-gradient(300px 300px at 70% 84%, rgba(152, 148, 140, 0.52), transparent 72%),
    radial-gradient(200px 200px at 28% 72%, rgba(112, 118, 126, 0.46), transparent 70%),
    linear-gradient(165deg, #e6e6ea 0%, #d1d1d8 55%, #bcbcc4 100%);
  filter: blur(48px) saturate(150%);
}

/* ---- dark theme: grey-black backdrop, translucent dark surfaces ---- */
body[data-ds-dark-theme] {
  background: #16161a;

  --ldd-fill-base: rgba(22, 22, 26, 0.62);
  --ldd-fill-sidebar: rgba(28, 28, 32, 0.66);
  --ldd-fill-input: rgba(32, 32, 37, 0.66);
  --ldd-edge: rgba(255, 255, 255, 0.16);
  --ldd-edge-soft: rgba(255, 255, 255, 0.08);
  --ldd-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);

  --dsw-alias-bg-base: var(--ldd-fill-base);
  --dsw-specific-sidebar-fill: var(--ldd-fill-sidebar);
  --dsw-specific-input-major: var(--ldd-fill-input);
  --dsw-alias-border-l1: var(--ldd-edge-soft);
}

body[data-ds-dark-theme]::before {
  background:
    radial-gradient(280px 280px at 78% 12%, rgba(255, 255, 255, 0.22), transparent 70%),
    radial-gradient(220px 220px at 14% 28%, rgba(168, 172, 182, 0.20), transparent 70%),
    radial-gradient(320px 320px at 70% 84%, rgba(150, 154, 164, 0.18), transparent 72%),
    radial-gradient(200px 200px at 28% 72%, rgba(255, 255, 255, 0.12), transparent 70%),
    linear-gradient(165deg, #1b1b20 0%, #141417 55%, #0a0a0c 100%);
  filter: blur(48px) saturate(140%);
}

/* ---- composer card: hairline top highlight + soft drop shadow. No
   backdrop-filter (a leaf's dropdown/tooltip can still be fixed-positioned). */
[data-composer-card] {
  box-shadow:
    inset 0 1px 0 var(--ldd-edge),
    var(--ldd-shadow);
}
`
