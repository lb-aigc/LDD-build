/**
 * LDD glass theme — an insertCSS overlay injected by the Electron shell after
 * the harness page loads. Neutral grey-black "liquid glass": a gradient + halo
 * backdrop on <body>, translucent fills on the MAIN surfaces only, hairline
 * highlights, no cyan/purple.
 *
 * HARD-WON RULES (both caused on-device bugs — do not reintroduce):
 * 1. NEVER put `backdrop-filter` on the frame / sidebar column / details
 *    column (or any container that can hold a `position: fixed` descendant).
 *    `backdrop-filter` (like `filter`/`transform`) creates a containing block,
 *    which breaks the settings modal's `position: fixed` overlay — the panel
 *    gets trapped inside the narrow sidebar column and its text renders
 *    vertically. This is the "settings page shows vertical text" bug.
 * 2. ONLY the MAIN surfaces go translucent: `--dsw-alias-bg-base` (conversation
 *    column), `--dsw-specific-sidebar-fill`, `--dsw-specific-input-major`
 *    (composer card). Do NOT touch `--dsw-alias-bg-layer-1/2/3`,
 *    `--dsw-alias-bg-overlay`, `--dsw-specific-menu`, etc. — those paint the
 *    settings modal / menus / popovers, which need OPAQUE, high-contrast
 *    surfaces (a translucent modal shows the page through it and looks broken).
 * 3. The backdrop gradient MUST be vivid enough that the translucent panels
 *    visibly "show through" it — otherwise the glass reads as a flat white/grey
 *    sheet. Tune the `--ldd-halo-*` alphas up until the layers are visible.
 */
export const GLASS_THEME_CSS = `
/* ================= LDD glass theme (insertCSS overlay) ================= */

/* ---- light theme: neutral grey, translucent main surfaces ---- */
body {
  --ldd-halo-a: rgba(255, 255, 255, 0.95);
  --ldd-halo-b: rgba(168, 172, 182, 0.70);
  --ldd-halo-c: rgba(196, 198, 208, 0.85);
  --ldd-halo-d: rgba(140, 144, 156, 0.55);
  --ldd-wall-0: #c7c7cd;
  --ldd-wall-1: #dcdce1;
  --ldd-wall-2: #e9e9ed;

  --ldd-fill-base: rgba(255, 255, 255, 0.52);
  --ldd-fill-sidebar: rgba(246, 246, 249, 0.58);
  --ldd-fill-input: rgba(255, 255, 255, 0.70);
  --ldd-edge: rgba(255, 255, 255, 0.70);
  --ldd-edge-soft: rgba(0, 0, 0, 0.07);
  --ldd-shadow: 0 8px 32px rgba(0, 0, 0, 0.16);

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

/* ---- dark theme: grey-black, translucent main surfaces ---- */
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

/* ---- composer card: hairline top highlight + soft drop shadow. Deliberately
   NO backdrop-filter even here — a leaf's dropdown/tooltip can still be
   fixed-positioned, so the safest glass is translucent-fill + highlight. ---- */
[data-composer-card] {
  box-shadow:
    inset 0 1px 0 var(--ldd-edge),
    var(--ldd-shadow);
}
`
