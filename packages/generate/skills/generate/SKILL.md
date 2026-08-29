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

## Fill the parameters

- `prompt`: rewrite the user's intent into a concrete, detailed visual or scene prompt (subject, action, camera movement, lighting, palette, mood, pacing). Keep the prompt in the user's language unless they asked otherwise.
- Image: set `count` for variants, `size` for orientation (use a portrait size such as `1024x1792` for a short-video cover), and an optional `style`.
- Image-to-image: when the user wants to transform an existing image — change its angle, viewpoint, or style from a picture you already have — pass `inputImages` as an array of image URLs (the URL an earlier `generate_image` returned, or a URL the user supplied). To use an image the USER just uploaded, pass `inputImages: ["@uploaded"]` — the tool reads the user's most recent uploaded image(s) and generates from them. Midjourney (`midjourney` / `legnext`) does not support i2i; route those requests to another provider.
- Video: set `durationSeconds`, `resolution`, and `aspectRatio` (`9:16` for vertical short-video).

## Report

Summarize what was generated (count and size/style for images; duration, resolution, aspect ratio for videos), and offer to refine the prompt or regenerate with changes.
