/**
 * LDD glass theme — an insertCSS overlay injected by the Electron shell after
 * the harness page loads. It converts the flat DeepSeek token sheet into a
 * neutral grey-black "liquid glass" surface: a gradient + halo backdrop on
 * <body>, translucent panel fills, hairline highlights, and backdrop-filter
 * blur on the frame and its columns.
 *
 * Everything rides CSS variables and stable data-* anchors (the CSS-module
 * class names are hashed and unusable), so it works across theme switches and
 * never touches upstream source. Tune the top token block; the rest references
 * it. Neutral grey only — no cyan, no purple (user requirement).
 */
export const GLASS_THEME_CSS = `
/* ================= LDD glass theme (insertCSS overlay) ================= */

/* ---- backdrop: gradient + neutral halos (the content the glass blurs) ---- */
body {
  --ldd-halo-a: rgba(255, 255, 255, 0.75);
  --ldd-halo-b: rgba(190, 190, 200, 0.60);
  --ldd-halo-c: rgba(210, 210, 220, 0.62);
  --ldd-halo-d: rgba(160, 160, 175, 0.40);
  --ldd-wall-0: #d9d9df;
  --ldd-wall-1: #ebebef;
  --ldd-wall-2: #f5f5f8;
  --ldd-blur: 34px;
  --ldd-sat: 160%;
  /* translucent panel fills (light) */
  --ldd-fill-base: rgba(255, 255, 255, 0.60);
  --ldd-fill-sidebar: rgba(250, 250, 252, 0.70);
  --ldd-fill-input: rgba(255, 255, 255, 0.72);
  --ldd-fill-layer: rgba(255, 255, 255, 0.55);
  /* hairline highlights (light) */
  --ldd-edge: rgba(255, 255, 255, 0.60);
  --ldd-edge-soft: rgba(0, 0, 0, 0.06);

  background:
    radial-gradient(900px 520px at 82% -12%, var(--ldd-halo-a), transparent 56%),
    radial-gradient(720px 500px at -12% 24%, var(--ldd-halo-b), transparent 60%),
    radial-gradient(1100px 720px at 50% 132%, var(--ldd-halo-c), transparent 64%),
    radial-gradient(500px 340px at 30% 6%, var(--ldd-halo-d), transparent 70%),
    linear-gradient(165deg, var(--ldd-wall-2) 0%, var(--ldd-wall-1) 55%, var(--ldd-wall-0) 100%) !important;
  background-attachment: fixed;

  /* override the flat token sheet with translucent fills */
  --dsw-alias-bg-base: var(--ldd-fill-base);
  --dsw-alias-bg-layer-1: var(--ldd-fill-layer);
  --dsw-alias-bg-layer-2: var(--ldd-fill-layer);
  --dsw-alias-bg-layer-3: var(--ldd-fill-layer);
  --dsw-alias-bg-overlay: var(--ldd-fill-layer);
  --dsw-alias-bg-module-platform: var(--ldd-fill-layer);
  --dsw-alias-bg-multi-select: var(--ldd-fill-layer);
  --dsw-specific-sidebar-fill: var(--ldd-fill-sidebar);
  --dsw-specific-input-major: var(--ldd-fill-input);
  --dsw-specific-menu: var(--ldd-fill-layer);
  --dsw-specific-selector: var(--ldd-fill-layer);
  --dsw-specific-tip: var(--ldd-fill-layer);
  --dsw-alias-button-elevated-fill: var(--ldd-fill-input);
  --dsw-alias-button-floating-fill: var(--ldd-fill-input);
  --dsw-alias-border-l1: var(--ldd-edge-soft);
  --dsw-alias-border-l2: rgba(0, 0, 0, 0.10);
}

/* ---- dark theme: grey-black, translucent, softer highlights ---- */
body[data-ds-dark-theme] {
  --ldd-halo-a: rgba(255, 255, 255, 0.26);
  --ldd-halo-b: rgba(255, 255, 255, 0.18);
  --ldd-halo-c: rgba(160, 160, 168, 0.22);
  --ldd-halo-d: rgba(255, 255, 255, 0.12);
  --ldd-wall-0: #0a0a0c;
  --ldd-wall-1: #131317;
  --ldd-wall-2: #1a1a1f;
  --ldd-blur: 36px;
  --ldd-sat: 170%;
  --ldd-fill-base: rgba(20, 20, 23, 0.68);
  --ldd-fill-sidebar: rgba(26, 26, 30, 0.74);
  --ldd-fill-input: rgba(30, 30, 34, 0.72);
  --ldd-fill-layer: rgba(24, 24, 28, 0.66);
  --ldd-edge: rgba(255, 255, 255, 0.16);
  --ldd-edge-soft: rgba(255, 255, 255, 0.07);

  background:
    radial-gradient(900px 520px at 82% -12%, var(--ldd-halo-a), transparent 56%),
    radial-gradient(720px 500px at -12% 24%, var(--ldd-halo-b), transparent 60%),
    radial-gradient(1100px 720px at 50% 132%, var(--ldd-halo-c), transparent 64%),
    radial-gradient(500px 340px at 30% 6%, var(--ldd-halo-d), transparent 70%),
    linear-gradient(165deg, var(--ldd-wall-2) 0%, var(--ldd-wall-1) 55%, var(--ldd-wall-0) 100%) !important;

  --dsw-alias-bg-base: var(--ldd-fill-base);
  --dsw-alias-bg-layer-1: var(--ldd-fill-layer);
  --dsw-alias-bg-layer-2: var(--ldd-fill-layer);
  --dsw-alias-bg-layer-3: var(--ldd-fill-layer);
  --dsw-alias-bg-overlay: var(--ldd-fill-layer);
  --dsw-alias-bg-module-platform: var(--ldd-fill-layer);
  --dsw-alias-bg-multi-select: var(--ldd-fill-layer);
  --dsw-specific-sidebar-fill: var(--ldd-fill-sidebar);
  --dsw-specific-input-major: var(--ldd-fill-input);
  --dsw-specific-menu: var(--ldd-fill-layer);
  --dsw-specific-selector: var(--ldd-fill-layer);
  --dsw-specific-tip: var(--ldd-fill-layer);
  --dsw-alias-button-elevated-fill: var(--ldd-fill-input);
  --dsw-alias-button-floating-fill: var(--ldd-fill-input);
  --dsw-alias-border-l1: var(--ldd-edge-soft);
  --dsw-alias-border-l2: rgba(255, 255, 255, 0.12);
}

/* ---- backdrop-filter: blur the backdrop through the frame + its columns ----
   The three-column frame has an unconditional child [data-shell-overlay], so
   :has() reverse-locates it (its class name is a hashed CSS-module token).
   Columns are the frame's first three direct div children. */
body :has(> [data-shell-overlay]) {
  backdrop-filter: blur(var(--ldd-blur)) saturate(var(--ldd-sat)) brightness(1.04);
  -webkit-backdrop-filter: blur(var(--ldd-blur)) saturate(var(--ldd-sat)) brightness(1.04);
}
body :has(> [data-shell-overlay]) > div:nth-child(1),
body :has(> [data-shell-overlay]) > div:nth-child(3) {
  backdrop-filter: blur(var(--ldd-blur)) saturate(var(--ldd-sat));
  -webkit-backdrop-filter: blur(var(--ldd-blur)) saturate(var(--ldd-sat));
}

/* ---- composer input card: the signature glass capsule ---- */
[data-composer-card] {
  backdrop-filter: blur(26px) saturate(var(--ldd-sat));
  -webkit-backdrop-filter: blur(26px) saturate(var(--ldd-sat));
  box-shadow:
    inset 0 1px 0 var(--ldd-edge),
    0 8px 32px rgba(0, 0, 0, 0.24);
}
`
