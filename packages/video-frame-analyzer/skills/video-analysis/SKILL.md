---
name: video-analysis
description: Use when a user asks to inspect, summarize, compare, search, or answer questions about an MP4, MOV, MKV, or WebM video in the current workspace.
---

# Analyze a video with LDD

Use `analyze_video` for visual evidence. The tool reads the local video with LDD's pinned FFmpeg, creates bounded timestamped contact sheets, and sends those images to the configured vision model. Do not claim that the raw video was sent to DeepSeek.

Provide a specific `goal`. For a video longer than 60 minutes, always provide `startSeconds` and `endSeconds` covering no more than 60 minutes. Start with `balanced` precision; use `high` only when short actions or fast scene changes need denser evidence, and use `low` for a broad first pass.

Base the response on `observations` and `evidenceTimestamps`. Report `warnings`, low-confidence observations, uncovered ranges, and the fact that audio is only detected, not transcribed. If a question depends on speech, ask for a transcript or explain that audio transcription is not part of this tool.
