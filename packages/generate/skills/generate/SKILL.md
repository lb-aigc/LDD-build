---
name: generate
description: Use when the user asks to create an image or a video — generate a picture, illustration, poster, avatar, or produce a video clip or animation from a description.
---

# Generate images and videos with LDD

Route image and video requests through the generation tools so the configured generation model runs — never answer with the prompt text itself.

## Decide which tool

- Still visual (picture, poster, avatar, illustration, photo) → `generate_image`.
- Moving footage (clip, animation, short video) → `generate_video`.

## Ask before generating when the intent is unclear

If the request is ambiguous — no subject, no style, or unclear whether the user wants an image or a video — ask one short clarifying question instead of guessing. Once clear, proceed without further confirmation.

## Image parameters

- `prompt`: rewrite the user's intent into a concrete, detailed visual prompt (subject, action, composition, lighting, palette, mood). Keep the prompt in the user's language unless they asked otherwise.
- `count` for variants; `aspectRatio` for composition (16:9, 9:16, 4:3, 3:4, 2:1, 1:2, 1:1, 4:5, 5:4, 21:9, 9:21 — omit for 16:9); `resolution` ALWAYS request `4K` first (degrades to 2K/1K only for ratios that cap lower); optional `style`.
- Image-to-image (`inputImages`): use for ANY request that modifies an existing image — removing an element, fixing/repairing, replacing the background, editing one part, restyling. Pass `inputImages` as an array of reference(s): an image URL, a local workspace file path (pass AS-IS, the tool reads it itself), or the sentinel `@uploaded` for an image the USER just attached. Put the edit instruction in `prompt`. NEVER write Python/OpenCV/PIL/compositing scripts to mask or erase images — always route through `generate_image`. Midjourney (`midjourney`/`legnext`) does not support i2i; route those to another provider.
- Video: set `durationSeconds`, `resolution`, and `aspectRatio` (`9:16` for vertical short-video).

---

# Video prompts — Seedance director rules (hard-won, verified)

The video prompt is a DIRECTING task, not a description task. You are the DIRECTOR; Seedance is the CAMERA OPERATOR. Apply these rules before and while writing any `generate_video` prompt.

## 0. Director first — answer three questions before any parameter

**Convey** (what to communicate) / **Feel** (what the audience feels) / **Shift** (how the emotion turns). Shot size, FOV, camera height, and move are all DERIVED from these three — they are the RESULT of intent, never the starting point. Do not start from "what parameters should I use"; start from "what must the audience feel".

## 1. Emotion is FOUR dimensions — missing one reads flat

Every character's emotion is a whole made of **face (表情) + eyes (眼神) + body (动作) + voice (话语)**, all consistent, all pointing at the SAME emotion. A character with only one dimension ("she says it softly") reads as a wooden placeholder.

- NEVER write the emotion LABEL ("she is angry", "he is afraid") — the engine does not execute labels.
- Translate the emotion into OBSERVABLE body markers across all four dimensions.
- **Reaction BEFORE the line**: write the body/face/eye reaction FIRST, then the spoken line. The emotion already happened before the words.

Weak: `Cora says softly, "My daughter is not your price."` (voice only)
Strong: `Cora's jaw trembles, she bites down to keep her voice steady (face+voice), eyes locked unblinking on the silver badge (eyes), shoulders braced to break free (body), each word forced through her teeth: {My daughter is not your price.}`

## 2. Engine hard limits (Seedance, verified — flag violations at authoring time)

- **Age-blind**: never `boy/girl/child/kid/young/teen/little` — describe by role + clothing + action ("the small figure in torn linen").
- **Exit-frame = cut**: a character who leaves the frame is GONE from that generation.
- **Off-screen = nonexistent**: characters not in frame do not exist to the model.
- **No mirror/reflection shots** (mirrors, windows, water reflections).
- **≤3 tracked characters** across cuts; crowd = "one lead + a few figures" in 1–2 reaction shots.
- **NO negative-prompt words** (`no/not/never/without`) — they inject the forbidden concept. Phrase everything as a POSITIVE constraint ("only N characters visible", not "no extra people").
- **Temperament words (cold / ruthless / aloof) must be written as PERFORMANCE** (expression / eyes / action / stillness), NEVER as physical light effects (cold light / frost / blue tint) — light-effect wording frosts the face.
- **Instant fail (<10s) = content-filter rejection** — do NOT resubmit unchanged; rephrase.

## 3. Camera moves — what it can and cannot do

**Can do** (write the VISIBLE EFFECT + MOTIVE, not just the name): push-in, pull-out, pan, track/follow, whip-pan, handheld, POV/first-person, orbit, and the special moves — dolly-zoom (Hitchcock), Michael Bay 360° orbit, Spielberg push-in. A move without a WHY is a glitch; "dolly-zoom, the background rushing away as the horror hits her face" holds, "dolly-zoom" alone does not.

**Rules**: one primary move + one fixed framing per shot (never hand-held + crane + orbit + macro at once). Limit push-ins to 1–2 per scene, always on a TIGHT size. Loose/wides default to a LOCKED-OFF camera.

**Cannot do**: a camera-deployment map / top-down CAM# diagram. The engine cannot read a floor plan of "which camera stands where" — describe the angle/move per shot in prose instead.

## 4. Shot size + FOV

8-rung ladder: close-up (face) → close shot (head/shoulders) → medium close-up (chest) → medium (waist) → medium long (full body) → full shot → long shot → extreme long. Tight sizes carry emotion; medium carries dialogue/action; loose carries space/scale.

- Tight sizes (close-up / medium close-up / insert) MUST add **FOV degrees + camera distance** (`29° FOV, camera 1.2m`) — the bare word "close-up" lets the engine pick a random framing.
- **9:16 vertical FORBIDS the frontal face close-up** ("passport photo"): a straight-on centered face stretches flat across the narrow frame. Use 3/4 side, low-angle, or high-angle instead, and add "NOT a flat frontal eye-level portrait".
- A tight↔loose jump for the SAME subject is an invalid cut — bridge through a middle size, or move the camera.

## 5. Position, screen-side & continuity

- **Screen side ≠ character side.** Write only SCREEN side (what the audience sees): "@SERVANT stands screen-left of @LEAD". A bare "on @LEAD's left" is ambiguous (mirrors when the person turns).
- **180° axis — never cross the line.** The master shot sets the side; every other shot shoots from the same side, or a character flips across the cut.
- **SOURCE + TARGET on every shot** ("from the entrance, looking up at @LEAD") — this is what stops characters drifting between cuts.
- **Blocking chain**: a segment's opening position = the previous segment's closing position, verbatim.
- **Cross-segment continuity**: open segment N with segment N-1's LAST frame as the reference image.

## 6. Dialogue

- **British accent (RP)**, never American — unless the user asks otherwise.
- **Language lock**: for non-Chinese dialogue, declare it EARLY ("speaking in English") and prefix the first line — a tail-only lock gets ignored and lines come back Chinese.
- **Tail breathing room**: the final spoken line finishes ≥1s BEFORE the segment's end, mouth CLOSED, body at rest, then a silent tail. If the line is too long (~2.5–3 words/sec), shorten it. Never end on a card-point.

## 7. Text is the #1 breakage

Exact text, numbers, names, logos, UI panels, on-screen data almost always garble or hallucinate. Decorative text = "blurred illegible decorative text". Anything that must be EXACT (a name, a number, a logo) → add in post-production, never ask the model to render it.

## 8. Failure lock table (quick fixes for recurring symptoms)

| Symptom | Lock to add |
|---|---|
| Empty first frame | "The first visible frame already contains [characters] in position." |
| Floating bodies / floaty motion | "Real ground contact, visible weight transfer, gravity on every object." |
| Wrong gaze direction | "Eyes locked on [target]. Torso faces [direction]. No gaze drift." |
| Lens drift | "No part of this shot becomes [wrong lens]. [Correct] maintained." |
| Flat lighting | "Exposed for backlight. Faces in shadow. Only rim light. No frontal key." |
| Scene drift | "Stay in [the named space]; never cut to a different room." |
| Extra characters | "Only [N] characters visible." |
| Subtitles / captions | "No subtitles. No captions. No on-screen text of any kind." |

---

## Scene routing (load the right sub-skill before writing video prompts)

This skill carries the GENERAL director rules (emotion / camera / engine limits) shared by ALL video prompts. Before writing a `generate_video` prompt, route by scene type and load the matching sub-skill via the `skill` tool:

- **Multi-shot short drama** (a script or storyboard → multiple segments, characters, blocking continuity, reference-image locking) → load `video-director` for restructuring / blocking / asset-lock / acting / output format.
- **Single-segment video** (a dance clip, atmosphere/mood video, vertical short, or game footage — ONE subject, ONE camera, one continuous shot) → load `video-single-shot` for full-body framing / tone / action beats / content safety.
- **Green/blue-screen background replacement** (real footage, swap the scene, make the person blend with the scene's ambient light — an ad or any compositing-style job) → load `green-screen-ad` for the environment-light integration prompt.

The rules below are the COMMON core. The sub-skills add what their scene type needs; do not skip them.

---

## Report

Summarize what was generated (count and size/style for images; duration, resolution, aspect ratio for videos), and offer to refine the prompt or regenerate with changes.

### Presenting generated images — the three hard rules

Generated images are rendered AUTOMATICALLY as thumbnails in the conversation
(with a download button) the moment generation finishes. Do NOT interfere with
that path. When you report an image result:

1. **NEVER save the images to the workspace** with a file-writing tool (do not
   create files like `street-mj-A-3x4.jpg`). The images already exist as durable
   attachments; writing them to disk as files forces the UI to render them as
   inert "file cards" that lose the download button.
2. **NEVER mention image files in backticks** (e.g. `` `street-mj-A-3x4.jpg` ``).
   A backticked filename is rendered as a file link, not the image. Describe the
   result in plain prose only.
3. **NEVER cherry-pick images.** Present EVERY generated image to the user. Do
   not choose a "primary"/"主推" subset and hide the rest — every variant must
   remain visible.

Describe the result in natural language (how many, what size/style), and offer
to refine the prompt or regenerate.
