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
- Image: set `count` for variants, `aspectRatio` for the composition (16:9, 9:16, 4:3, 3:4, 2:1, 1:2, 1:1, 4:5, 5:4, 21:9, 9:21 — omit for 16:9), and `resolution` (ALWAYS request `4K` first; the tool degrades to `2K` then `1K` automatically ONLY for the ratios that cap lower — `1:1` caps at 2K, `4:5`/`5:4`/`9:21` cap at 1K), plus an optional `style`.
- Image-to-image: when the user wants to transform an existing image — change its angle, viewpoint, or style from a picture you already have — pass `inputImages` as an array. Each entry is one of: an image URL (the URL an earlier `generate_image` returned), a local file path to a workspace image (e.g. `D:/file/inputs/ref.jpg` — pass the path AS-IS, the tool reads the file itself; NEVER write shell/Node scripts to upload it), or the sentinel `@uploaded` to use an image the USER just attached. Do not write PowerShell/Node scripts to call the relay directly — always route through `generate_image`. Midjourney (`midjourney` / `legnext`) does not support i2i; route those requests to another provider.
- Video: set `durationSeconds`, `resolution`, and `aspectRatio` (`9:16` for vertical short-video).

## Report

Summarize what was generated (count and size/style for images; duration, resolution, aspect ratio for videos), and offer to refine the prompt or regenerate with changes.
