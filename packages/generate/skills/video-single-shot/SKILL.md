---
name: video-single-shot
description: Use when the user asks for a SINGLE-segment video prompt (NOT a multi-shot short drama) — a dance clip, atmosphere/mood video, vertical short, or game footage. One subject, one camera, one continuous shot.
---

# Single-shot video prompts — dance / atmosphere / game footage

A single-segment video = one subject, one camera, one continuous generation. This is the framing / tone / action / content-safety layer that `generate` (general rules) does not cover. Read `generate` first for the shared emotion/camera/engine limits. This skill does NOT apply to multi-shot short drama — use `video-director` there.

## 1. One subject only (Seedance can't lock a group)

Multi-person blocking and group action collapse. Every single-shot segment has exactly ONE subject. Dance clips, streamers, atmosphere videos — all single-subject.

## 2. Full-body framing, 9:16 vertical

A tall narrow frame forces you to pull back and drop the angle to fit a full body:

- FOV: default `35mm`; if head/toes get cropped drop to `28mm` (wider) or pull the camera back.
- Camera distance: `2.5–3m`.
- Camera height: slightly BELOW the waist (lengthens legs + curve) or eye level.
- Fixed negative clause: 头顶与脚尖始终完整入镜 ("head and toes always fully in frame").
- Most stable sentence: `full body shot, ~35mm FOV, camera about 2.5m from the subject, height slightly below the waist`.

## 3. Tone recipes (the elements that actually work)

Never write the word "atmosphere" bare — build it from CONCRETE physical elements:

- Smoke (thin mist / incense haze drifting through the light), backlight / rim-light contour (gold edge along hair + curves), neon / sign soft-focus bokeh, floor reflection (wet / mirror), disco-ball speckles, paper lanterns / candle glow.
- Warm/cool contrast = a cool/warm base + ONE warm focal point (a lamp / a lantern / one warm object). Pure cold loses a layer of tension.
- Cool low-key: cool-blue base, shadows tinted midnight blue (not dead black), only 1–2 light sources on the subject; SPLIT-TONING shadows at 220–240° is mandatory (white-balance + HSL alone can't get the thickness).
- Warm mood: warm orange/red/gold key + backlight rim + floor reflection.

## 4. Action beats

~3 action beats per segment, each landing on a readable final pose. Never just write "dancing". One primary camera move + one fixed framing per shot (never hand-held + crane + orbit + macro at once).

## 5. Sexy-but-safe content boundary

Write "hot/sexy" through wardrobe + body description, never explicit words:

- Wardrobe: sequined bodycon dress, high-slit qipao (off-shoulder), silk slip dress, mini-skirt + crop top, sports tube-top + hot pants, leather skirt + boots, bikini.
- Body: curves, slim waist, long legs, collarbone, waist-hip curve.
- Differentiate looks by PAIRING wardrobe + scene (bikini→pool, bunny→disco, gown→dance floor, JK→rooftop, tennis skirt→court, yukata→Japanese warm room), never just changing colors.

## 6. Image-to-image inpaint

For local replacement (change a region, keep everything else): declare each reference's role ("@Image1 defines only the scene/structure; @Image2 defines only the screen content"), lock the replacement rule semantically, and add negative locks protecting the untouched regions. Exact on-screen text (numbers, logos) cannot be reproduced — post it or accept a "dark panel + red glow" look.

## 7. Game footage (FPS — CS / Delta Force style)

If the single-shot is first-person game footage:

- UE5 real-time render, first-person POV, generic HUD (crosshair + ammo + health, no trademarks), 16:9 landscape.
- Weapon: name the EXACT model ("M4" / a specific sniper) — a generic "a gun" gets rendered as a sniper.
- Negative-lock the red highlight (the engine hallucinates an ESP wallhack overlay); write "no red enemy highlights".
- Player keeps moving — never standing still (a static player reads as AFK).
- Enemy peeking = the enemy leans their UPPER BODY over cover (feet not visible), never a head sticking out from the side of a wall.

## 8. Delivery format

Per segment, one code block in order: 成片规格 (aspect / duration / pure video no UI) → 景别机位 (FOV / distance / camera height / move) → 人物 (hair / wardrobe / body / makeup / expression) → 动作节拍 (3 beats → final pose) → 影调 (concrete light sources) → 负面约束.

Mixed language: scene / action / lighting / blocking / wardrobe in Chinese; FOV / focal length / camera distance / move terms kept in English (`full body shot / 35mm FOV / low-key`).
