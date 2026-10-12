---
name: video-analysis
description: Use when a user asks to inspect, summarize, compare, search, or answer questions about an MP4, MOV, MKV, or WebM video in the current workspace.
---

# Analyze a video with LDD

Use `analyze_video` for visual evidence. The tool reads the local video with LDD's pinned FFmpeg, creates bounded timestamped contact sheets, and sends those images to the configured vision model. Do not claim that the raw video was sent to DeepSeek.

## Write a SPECIFIC goal (this decides analysis quality)

A vague goal ("analyze this video") returns a vague summary. The goal must name WHAT to observe and, ideally, WHY. Good goals:

- "哪个角色站在什么位置，机位是仰拍还是俯拍，光从哪边来" (position / camera / lighting)
- "这个镜头里的人物是否还穿着上一段的外套，发型有没有变" (cross-clip continuity)
- "逐镜记录：景别、运镜、人物动作、是否有台词" (shot-by-shot log)
- "找出所有出现人物的画面，并描述每个人的穿着和动作" (character inventory)

For cross-clip continuity (does clip B open where clip A ended?), say so explicitly — the answer lives in A's last frame vs B's first frame, and the tool will only compare them if you ask.

## Choose precision by the job

| Precision | When |
|---|---|
| `low` | Broad first pass over a long video — get the structure and major beats cheaply. |
| `balanced` | Default. Good coverage for most inspection and QA tasks. |
| `high` | Short actions, fast scene changes, or dense evidence — when you need a fine-grained read. |

For a video longer than 60 minutes, ALWAYS provide `startSeconds` and `endSeconds` covering no more than 60 minutes — split long videos into ranges.

## Read the result by its structure

The result is evidence, not prose. Use it precisely:

- `observations[].summary` — what was seen in each analyzed interval.
- `observations[].evidenceTimestamps` — the exact second(s) that back each observation. Cite these when reporting; they are your proof.
- `observations[].confidence` (`low`/`medium`/`high`) — weight your claims by it; report low-confidence observations AS low-confidence.
- `coverage.analyzedRange` + `coverage.uncoveredIntervals` — the ranges the analysis DID and DID NOT cover. If a question falls in an uncovered interval, say so and re-run with a range that covers it.
- `warnings` / `decodeWarnings` — decoding or sampling problems; surface them, they may mean the evidence is incomplete.

## Known limits (state them, don't paper over)

- **Audio is DETECTED, not transcribed.** `hasAudio` only says a track exists. If a question depends on speech, ask for a transcript or explain that this tool does not transcribe.
- The tool sends **contact-sheet images** to the vision model, never the raw video. Answer from `observations` + `evidenceTimestamps`, not from claiming the video itself was read.

## Multi-pass strategy

For a thorough read, run a `low` pass first to learn the structure and beat map, then a `high` pass over the specific ranges that matter. Do not run `high` over the whole video blind — it is slower and most of it is waste.
