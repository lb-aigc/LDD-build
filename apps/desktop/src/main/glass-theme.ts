/**
 * LDD glass theme — injected by the Electron shell into the harness page as a
 * <style id="ldd-glass-theme"> appended to <head>. Neutral grey "liquid glass":
 * a grey-tone gradient + halo backdrop on <body>, translucent fills on the MAIN
 * surfaces only, hairline top highlight. No cyan, no purple.
 *
 * HARD-WON RULES (each caused an on-device bug — do not reintroduce):
 * 1. NEVER put `backdrop-filter` on the frame / sidebar / details column (or
 *    any container that can hold a `position: fixed` descendant): it creates a
 *    containing block and breaks the settings modal's fixed overlay — the panel
 *    gets trapped in the narrow sidebar column and its text renders VERTICALLY
 *    (the "settings page shows vertical text" bug).
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

/* ---- light theme: grey backdrop, translucent white surfaces ---- */
body {
  /* grey-tone backdrop (visible grey steps, not white-on-white) */
  --ldd-halo-a: rgba(140, 144, 152, 0.42);
  --ldd-halo-b: rgba(110, 114, 122, 0.34);
  --ldd-halo-c: rgba(168, 172, 180, 0.38);
  --ldd-halo-d: rgba(96, 100, 108, 0.28);
  --ldd-wall-0: #b6b6be;
  --ldd-wall-1: #ceced5;
  --ldd-wall-2: #e0e0e5;

  /* translucent white fills */
  --ldd-fill-base: rgba(255, 255, 255, 0.46);
  --ldd-fill-sidebar: rgba(250, 250, 252, 0.50);
  --ldd-fill-input: rgba(255, 255, 255, 0.66);
  --ldd-edge: rgba(255, 255, 255, 0.62);
  --ldd-edge-soft: rgba(0, 0, 0, 0.08);
  --ldd-shadow: 0 8px 32px rgba(60, 62, 68, 0.18);

  background:
    radial-gradient(900px 520px at 82% -12%, var(--ldd-halo-a), transparent 56%),
    radial-gradient(720px 500px at -12% 24%, var(--ldd-halo-b), transparent 60%),
    radial-gradient(1100px 720px at 50% 132%, var(--ldd-halo-c), transparent 64%),
    radial-gradient(500px 340px at 30% 6%, var(--ldd-halo-d), transparent 70%),
    linear-gradient(165deg, var(--ldd-wall-2) 0%, var(--ldd-wall-1) 55%, var(--ldd-wall-0) 100%) !important;

  /* main surfaces only */
  --dsw-alias-bg-base: var(--ldd-fill-base);
  --dsw-specific-sidebar-fill: var(--ldd-fill-sidebar);
  --dsw-specific-input-major: var(--ldd-fill-input);
  --dsw-alias-border-l1: var(--ldd-edge-soft);
}

/* ---- dark theme: grey-black backdrop, translucent dark surfaces ---- */
body[data-ds-dark-theme] {
  --ldd-halo-a: rgba(255, 255, 255, 0.30);
  --ldd-halo-b: rgba(255, 255, 255, 0.20);
  --ldd-halo-c: rgba(168, 172, 182, 0.26);
  --ldd-halo-d: rgba(255, 255, 255, 0.13);
  --ldd-wall-0: #0a0a0c;
  --ldd-wall-1: #141417;
  --ldd-wall-2: #1b1b20;

  --ldd-fill-base: rgba(22, 22, 26, 0.66);
  --ldd-fill-sidebar: rgba(28, 28, 32, 0.72);
  --ldd-fill-input: rgba(32, 32, 37, 0.72);
  --ldd-edge: rgba(255, 255, 255, 0.18);
  --ldd-edge-soft: rgba(255, 255, 255, 0.08);
  --ldd-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);

  background:
    radial-gradient(900px 520px at 82% -12%, var(--ldd-halo-a), transparent 56%),
    radial-gradient(720px 500px at -12% 24%, var(--ldd-halo-b), transparent 60%),
    radial-gradient(1100px 720px at 50% 132%, var(--ldd-halo-c), transparent 64%),
    radial-gradient(500px 340px at 30% 6%, var(--ldd-halo-d), transparent 70%),
    linear-gradient(165deg, var(--ldd-wall-2) 0%, var(--ldd-wall-1) 55%, var(--ldd-wall-0) 100%) !important;

  --dsw-alias-bg-base: var(--ldd-fill-base);
  --dsw-specific-sidebar-fill: var(--ldd-fill-sidebar);
  --dsw-specific-input-major: var(--ldd-fill-input);
  --dsw-alias-border-l1: var(--ldd-edge-soft);
}

/* ---- composer card: hairline top highlight + soft drop shadow. No
   backdrop-filter (a leaf's dropdown/tooltip can still be fixed-positioned). */
[data-composer-card] {
  box-shadow:
    inset 0 1px 0 var(--ldd-edge),
    var(--ldd-shadow);
}
`
