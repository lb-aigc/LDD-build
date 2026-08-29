# LDD Generate

`@ldd/dsh-generate` registers two model-facing tools that let the DeepSeek
Harness agent create images and videos through a configured generation model:

- `generate_image` — text prompt → one or more images (count, size, style);
  pass `inputImages` (an array of http(s) URLs or `data:` URIs) for
  image-to-image generation.
- `generate_video` — text prompt → a short video (duration, resolution, aspect ratio).

The LLM stays the brain: it reads the user's request, picks the right tool from
the descriptions and the `generate` skill, fills the parameters, and continues
the multi-turn conversation from the result. The user never switches models
manually.

## Provider presets and protocols

Generation routes through a small provider table, not a hardcoded backend. The
user picks a **preset** in settings (or leaves the default), and the preset maps
to a **wire protocol** implemented by an adapter in `src/providers/`:

| Preset id      | Protocol          | Adapter                          |
|----------------|-------------------|----------------------------------|
| `mock`         | `mock`            | `MockGenerationProvider`         |
| `gpt-image`    | `openai-compatible` | `OpenAICompatibleProvider`     |
| `nano-banana`  | `gemini`          | `GeminiImageProvider`            |
| `midjourney`   | `midjourney`      | `MidjourneyProvider` (async)     |
| `seedream`     | `volcengine`      | `VolcengineProvider`             |
| `custom`       | settings-supplied | any adapter via `settings.protocol` |

One protocol serves many hosts: `openai-compatible` drives gpt-image-2 and every
OpenAI-compatible aggregator, so adding a new backend is usually just a new
preset row (or a `custom` selection) — not a new adapter.

## Image-to-image

When `generate_image` receives `inputImages`, each adapter switches to its
image-to-image wire form:

| Protocol          | i2i wire shape                                                                 |
|-------------------|-------------------------------------------------------------------------------|
| `openai-compatible` | `POST /images/edits` (multipart `image` parts, downloaded from the URLs)     |
| `gemini`          | `generateContent` with reference `inlineData` parts before the text           |
| `volcengine`      | `images/generations` with a base64 `image` field (SeedEdit model)             |
| `kie`             | `createTask` with `input_urls` (public URLs), `aspect_ratio`, `resolution`    |
| `midjourney`      | **unsupported** — MJ i2i consistency is too poor to expose                    |
| `legnext`         | **unsupported** — it is a Midjourney relay                                    |

Providers whose i2i model differs from their text model (KIE, Volcengine) read
the per-row `imageToImageModel` setting; GPT Image and Gemini reuse `model`
(text and i2i are the same model).

## Settings

The two capabilities configure independently under two namespaces (stored in the
harness `settings.yaml`, hot-reloaded):

```yaml
generate-image:
  provider: mock        # mock | gpt-image | nano-banana | midjourney | seedream | custom
  protocol: ''          # required only when provider is "custom"
  model: ''             # blank inherits the preset default
  imageToImageModel: '' # i2i model id (KIE/Seedream); blank reuses `model`
  baseURL: ''           # blank inherits the preset default
  apiKeyEnv: ''         # reference to the API key (env var / credentials domain), never the key itself
generate-video:
  provider: mock
  # ... same shape
```

The API key is resolved from its reference at request time (`src/credentials.ts`);
the settings document never carries a secret. `timeoutMs` remains a static
Cordis config in `cordis.patch.yml`, not a per-request setting.

## Adding a backend

1. **New protocol family** → implement `GenerationProvider` in `src/providers/`,
   register it in `src/providers/index.ts` `createProvider`, and add the
   protocol to `PROVIDER_PROTOCOLS` in `src/presets.ts`.
2. **New preset on an existing protocol** → add a row to
   `IMAGE_PROVIDER_PRESETS` / `VIDEO_PROVIDER_PRESETS` in `src/presets.ts`.
