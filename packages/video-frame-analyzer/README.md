# @ldd/dsh-video-frame-analyzer

LDD's bundled DeepSeek Harness plugin registers `analyze_video`, the `/__ldd/identity` loopback route, and the `video-analysis` skill. It does not send a raw video to a model. It authorizes a workspace file, probes it with LDD's pinned `ffprobe`, detects scene changes and extracts bounded timestamped contact sheets with LDD's pinned `ffmpeg`, persists those JPEG sheets through `ctx.attachments`, and sends them to a configured image-capable route.

## Tool behavior

`analyze_video` accepts `path`, `goal`, optional `startSeconds`/`endSeconds`, and optional `precision` (`low`, `balanced`, or `high`). MP4, MOV, MKV, and WebM are supported. A file must be a regular non-link file inside the calling Session workspace and no larger than 2 GiB. Videos longer than 60 minutes require an explicit range no wider than 60 minutes.

Sampling uses a one-second base interval below 30 seconds, three seconds through five minutes, and ten seconds above five minutes. Scene-change timestamps are retained first. One contact sheet contains at most nine frames, one vision request contains at most four sheets/36 frames, and one analysis contains at most 16 sheets/144 frames. Cancellation stops tracked FFmpeg process trees before an ownership-marked private temporary directory is removed.

Before each nested model request, the plugin appends `video/analysis-input` with the exact route, system instruction, user message, contact-sheet references, sampling facts, and output-token cap. The request begins only after that append succeeds. A package invariant requires batch indices to be contiguous and the route to remain stable within one analysis.

Harness 0.1.1 uses a generated persistence vocabulary. LDD's source-built fallback carries a reviewed source patch for this event, and the plugin registers the same event at module load for integrity-verified registry installations. Candidate installation refuses activation unless that durable registration probe succeeds.

The bundle's default LDD layer routes vision work to `deepseek-official/deepseek-v4-flash-vision-exp`. The route is resolved at execution and must explicitly advertise image input. The result contains video metadata, chronological observations, visible text, evidence timestamps, warnings, the route, and request count. Malformed model output becomes a bounded low-confidence observation instead of unvalidated JSON.

## Configuration

The bundled `cordis.patch.yml` supplies every deployment choice: provider/model, default precision, output and timeout limits, absolute FFmpeg/ffprobe paths, private cache root, scene threshold, and process-stop deadlines. `LDD_IDENTITY_NONCE` is required at load; the identity route returns it only over a loopback connection with the current process id and disables caching.

## Model Experience

### analyze_video tool schema

#### What the model sees

The model sees the tool description and argument schema while the plugin is mounted. A successful result is a compact JSON value containing bounded observations and evidence, not contact-sheet image blocks.

#### Token effect

The main conversation pays for the tool schema and structured result. Each analysis also makes one independent image-model request per group of at most four contact sheets; those images and the fixed analysis instruction consume that auxiliary request's input budget.

#### KV Cache effect

Tool registration changes the conversation request prefix while mounted. Each nested vision request is independent; changing the goal, range, sampling precision, route, or contact-sheet references changes its input and cache identity.

## Known Limitations and Deferred Work

- Audio presence is reported, but audio is not transcribed.
- The first release accepts workspace-contained files only; a separate explicit read-authorization provider for outside-workspace files is not yet connected.
- Contact sheets require a pinned FFmpeg build with the `drawtext`, `concat`, and `tile` filters.
- Scene detection and interval sampling cannot guarantee that every short event appears; warnings and uncovered ranges must remain visible to the caller.
