---
name: green-screen-ad
description: Use when the user wants to replace the background of REAL green-screen or blue-screen footage in an ad — keep the person, swap the scene, and make them blend into it (the subject must take the scene's ambient light). Prompt-only: this skill WRITES the prompt, it does not run any video editing.
---

# Green-screen / blue-screen background replacement — ad prompts

Replace the background of real green/blue-screen footage while the person stays put and reads as though they were SHOT in the new scene. The whole job is one thing: **the person must blend — they take the scene's light, they are not a sticker pasted on top.**

This skill produces the PROMPT only. It never edits footage itself.

## 1. Core idea: keying is replaced by a prompt, not by "paste a background"

The traditional pipeline (key → despill → composite → match light/shadow/grain) is replaced by ONE Seedance prompt — but only if the prompt writes the INTEGRATION explicitly. Color-matching alone is the #1 cause of "looks pasted in": a color-correct subject that does not share the scene's light, atmosphere and grain still reads as a cutout.

## 2. Mode routing (Seedance 2.5)

- Run it as **`omni_reference` with the source clip attached as a video reference** — NOT `video_edit`. This is the lane where `duration` is settable and must EQUAL the source.
- Source clip must be **≥ 4 s** (the duration floor). Pad a shorter clip by freeze-framing its last frame.
- 2.5 caps at **720p** — no 1080p/4K. State this; do not promise 4K.

## 3. Reference-role declaration (each material: role + exclusion)

```
@Video 1 — the green-screen source: master for the person's identity, camera,
framing, focus, motion, expression timing and duration. Do NOT use the green
background or its color.
@Image 1 — the replacement scene: use only its spatial layout, materials,
lighting direction and atmosphere. Do not use any people in the image.
@Image 2 — the product (if any): shape, material, color. Do not use its
background or staging.
```

## 4. Environment-light integration — the four elements (this is the whole skill)

These four make the person read as "shot here", not "pasted here". Write ALL four; one missing and the subject looks stuck on.

1. **Key light (主光)** — name the key direction and match it across person + scene: "the key comes from screen-left, soft, with soft-edged shadows of the same density on the person and the room." The person and the scene share ONE key.
2. **Environmental bounce (环境反光)** — the scene spills its light onto the person: cool skylight from above, warm bounce from the sunlit ground, the scene's dominant color tinting the subject's edges. "The neon spills across her cheek as the wall throws blue back onto her shoulder."
3. **Optics & atmosphere (光学/大气)** — match lens character, micro-contrast, aerial perspective, depth-of-field falloff and film grain. A person crisper than a hazy background is the classic tell: "the subject carries the same atmospheric haze and focus falloff as the background — never unnaturally sharp."
4. **Edges & grounding (边缘/落地)** — no hard cut-out edges, no halo, no spill, and a real contact shadow so the person occupies the space: "soft contact shadow where she stands; no rim halo, no hard outline."

## 5. The anti-paste lock (say it, or it composites clean and reads pasted)

Close with one clause that names every compositing artifact and kills it:

```
Grain, motion blur, focus falloff, compression character and color all match the
source so the person is indistinguishable from originally shot footage.
```

## 6. Green/blue-screen specific traps

- **Spill (色溢)**: the green/blue light bleeds onto the subject's edges — hair, shoulders, skin reflections. Write "no green spill on the hair or skin edges; clean natural skin tone" (and exclude the screen color in the source's role, §3).
- **Skin-tone protection (肤色保护)**: a cold scene's blue saturation must NOT tint the face. "The face keeps natural warm skin tone; the scene's blue affects the surroundings, never the skin."
- **Don't let the screen color leak into the new scene** — restate "no green/blue tint anywhere in the frame" in the scene description.

## 7. Ad structure (keep it light — this is the VFX layer, not the whole TVC)

- 0–3s hook tied to the product or claim (no empty city/atmosphere opening).
- Product/brand appearance rule: exact logo, pack text, prices, disclaimers → POST-PRODUCTION, never in the prompt.
- Close on a stable packshot (the person + product in the new scene, settled).
- Audio via bracket syntax if needed: `()` music, `<>` SFX, `{}` dialogue, `【】` subtitles; `(no music)` to suppress.

## 8. Prompt template (copy-fillable)

```
@Video 1 — the green-screen source: master for the person's identity, camera,
framing, focus, motion, expression timing and duration. Do NOT use the green
background or its color.
@Image 1 — the replacement scene: layout, materials, lighting direction and
atmosphere only. Do not use any people in it.
[+ @Image 2 — the product: shape, material, color; not its background.]

Replace the background of @Video 1 with the scene in @Image 1. Keep the person's
face, identity, wardrobe, performance and camera motion EXACTLY as in @Video 1.

<Scene, one sentence — time, place, mood, the visible light and color.>

Lighting integration: the key comes from <screen-left/right>, soft, and the person
and the scene share it. The scene's <cool skylight / warm ground bounce / dominant
color> spills onto the person — <concrete bounce, e.g. "the neon washes blue over
her shoulder">. The subject carries the same atmospheric haze, depth-of-field
falloff and film grain as the background; never unnaturally sharp. No hard cut-out
edge, no halo, no green spill on the hair or skin — a soft contact shadow grounds
the person in the space.

<Ad beat: 0–3s hook → the person with/using the product in the new scene →
settled packshot.>

Grain, motion blur, focus falloff, compression character and color all match the
source so the person is indistinguishable from originally shot footage.
```

## 9. Failure → fix table

| Symptom | Fix |
|---|---|
| Person looks pasted on | Write the four integration elements (§4) + the anti-paste lock (§5) |
| Green/blue edge on hair/shoulders | Add the spill lock (§6) + exclude the screen color in the source role |
| Person sharper than the background | Add the optics/atmosphere element (§4.3) |
| Scene light doesn't touch the person | Add the environmental bounce (§4.2) |
| Face turned cold/blue | Add the skin-tone protection lock (§6) |
| Scene leaks people from its reference | The scene image's "do not use any people" exclusion (§3) |
