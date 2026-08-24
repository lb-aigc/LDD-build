# LDD Generate

`@ldd/dsh-generate` registers two model-facing tools that let the DeepSeek
Harness agent create images and videos through a configured generation model:

- `generate_image` — text prompt → one or more images (count, size, style).
- `generate_video` — text prompt → a short video (duration, resolution, aspect ratio).

The LLM stays the brain: it reads the user's request, picks the right tool from
the descriptions and the `generate` skill, fills the parameters, and continues
the multi-turn conversation from the result. The user never switches models
manually.

## GenerationProvider

Tool bodies call an injectable `GenerationProvider`. The shipped
`MockGenerationProvider` returns self-describing placeholder results so the
routing link (request → decision → tool dispatch → result → follow-up) runs
end to end without a live image/video API. To wire a real backend, implement
`GenerationProvider` and register it under `config.provider` in `src/index.ts`;
the tools, skill, and plugin-tree wiring stay unchanged.
