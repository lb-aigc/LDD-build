import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

import { applyTrackedUpstreamPatches } from '../src/upstream-patches.ts'

const repositoryRoot = resolve(import.meta.dirname, '..', '..', '..')

// Patch target files (union of the 8 tracked patches' targets, de-duplicated).
// Each patch file must have every target copied into the temp root before apply.
const officialCatalog = join(repositoryRoot, 'upstream', 'deepseek-harness', 'packages', 'core', 'session', 'src', 'known-event-types.ts')
const officialReleaseProcess = join(repositoryRoot, 'upstream', 'deepseek-harness', 'scripts', 'release', 'process.ts')
const officialBrand = join(repositoryRoot, 'upstream', 'deepseek-harness', 'packages', 'client', 'ui-brand-official', 'src', 'client', 'Brand.tsx')
const officialLocales = join(repositoryRoot, 'upstream', 'deepseek-harness', 'packages', 'client', 'ui-conversation', 'src', 'client', 'locales.ts')
const officialEmptyHero = join(repositoryRoot, 'upstream', 'deepseek-harness', 'packages', 'client', 'ui-conversation', 'src', 'client', 'skeleton', 'EmptyHero.tsx')
const officialHeroShell = join(repositoryRoot, 'upstream', 'deepseek-harness', 'packages', 'client', 'ui-conversation', 'src', 'client', 'skeleton', 'HeroShell.module.css')
const officialClientBuildEnvironment = join(repositoryRoot, 'upstream', 'deepseek-harness', 'scripts', 'client-build-environment.ts')
const officialSidebarRoot = join(repositoryRoot, 'upstream', 'deepseek-harness', 'packages', 'client', 'ui-sidebar', 'src', 'client', 'SidebarRoot.tsx')
const officialSlots = join(repositoryRoot, 'upstream', 'deepseek-harness', 'packages', 'client', 'ui-conversation', 'src', 'client', 'contract', 'slots.ts')
const officialApply = join(repositoryRoot, 'upstream', 'deepseek-harness', 'packages', 'client', 'ui-conversation', 'src', 'client', 'apply.ts')
const officialInputBar = join(repositoryRoot, 'upstream', 'deepseek-harness', 'packages', 'client', 'ui-conversation', 'src', 'client', 'skeleton', 'InputBar.tsx')
const officialImageLightbox = join(repositoryRoot, 'upstream', 'deepseek-harness', 'packages', 'client', 'ui-attachment', 'src', 'ImageLightbox.tsx')
const officialMessageImage = join(repositoryRoot, 'upstream', 'deepseek-harness', 'packages', 'client', 'ui-attachment', 'src', 'MessageImage.tsx')
const officialImageLightboxCss = join(repositoryRoot, 'upstream', 'deepseek-harness', 'packages', 'client', 'ui-attachment', 'src', 'ImageLightbox.module.css')
const officialAttachmentLabels = join(repositoryRoot, 'upstream', 'deepseek-harness', 'packages', 'client', 'ui-attachment', 'src', 'client', 'labels.ts')
const officialCodeBlock = join(repositoryRoot, 'upstream', 'deepseek-harness', 'packages', 'client', 'ui-primitives', 'src', 'markdown', 'CodeBlock.tsx')
const officialCodeBlockCss = join(repositoryRoot, 'upstream', 'deepseek-harness', 'packages', 'client', 'ui-primitives', 'src', 'markdown', 'CodeBlock.module.css')
const officialMarkdownText = join(repositoryRoot, 'upstream', 'deepseek-harness', 'packages', 'client', 'ui-primitives', 'src', 'markdown', 'MarkdownText.tsx')
const officialStream = join(repositoryRoot, 'upstream', 'deepseek-harness', 'packages', 'llm', 'llm-pi-ai', 'src', 'stream.ts')

const patchRoot = join(repositoryRoot, 'patches', 'deepseek-harness', '0.1.5-rc.1')

test('tracked Harness patches add LDD compatibility changes and apply exactly once', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'ldd-upstream-patch-'))
  try {
    const copiedRoot = join(parent, 'source')
    const copiedCatalog = join(copiedRoot, 'packages', 'core', 'session', 'src', 'known-event-types.ts')
    const copiedReleaseProcess = join(copiedRoot, 'scripts', 'release', 'process.ts')
    const copiedBrand = join(copiedRoot, 'packages', 'client', 'ui-brand-official', 'src', 'client', 'Brand.tsx')
    const copiedLocales = join(copiedRoot, 'packages', 'client', 'ui-conversation', 'src', 'client', 'locales.ts')
    const copiedEmptyHero = join(copiedRoot, 'packages', 'client', 'ui-conversation', 'src', 'client', 'skeleton', 'EmptyHero.tsx')
    const copiedHeroShell = join(copiedRoot, 'packages', 'client', 'ui-conversation', 'src', 'client', 'skeleton', 'HeroShell.module.css')
    const copiedClientBuildEnvironment = join(copiedRoot, 'scripts', 'client-build-environment.ts')
    const copiedSidebarRoot = join(copiedRoot, 'packages', 'client', 'ui-sidebar', 'src', 'client', 'SidebarRoot.tsx')
    const copiedSlots = join(copiedRoot, 'packages', 'client', 'ui-conversation', 'src', 'client', 'contract', 'slots.ts')
    const copiedApply = join(copiedRoot, 'packages', 'client', 'ui-conversation', 'src', 'client', 'apply.ts')
    const copiedInputBar = join(copiedRoot, 'packages', 'client', 'ui-conversation', 'src', 'client', 'skeleton', 'InputBar.tsx')
    const copiedImageLightbox = join(copiedRoot, 'packages', 'client', 'ui-attachment', 'src', 'ImageLightbox.tsx')
    const copiedMessageImage = join(copiedRoot, 'packages', 'client', 'ui-attachment', 'src', 'MessageImage.tsx')
    const copiedImageLightboxCss = join(copiedRoot, 'packages', 'client', 'ui-attachment', 'src', 'ImageLightbox.module.css')
    const copiedAttachmentLabels = join(copiedRoot, 'packages', 'client', 'ui-attachment', 'src', 'client', 'labels.ts')
    const copiedCodeBlock = join(copiedRoot, 'packages', 'client', 'ui-primitives', 'src', 'markdown', 'CodeBlock.tsx')
    const copiedCodeBlockCss = join(copiedRoot, 'packages', 'client', 'ui-primitives', 'src', 'markdown', 'CodeBlock.module.css')
    const copiedMarkdownText = join(copiedRoot, 'packages', 'client', 'ui-primitives', 'src', 'markdown', 'MarkdownText.tsx')
    const copiedStream = join(copiedRoot, 'packages', 'llm', 'llm-pi-ai', 'src', 'stream.ts')

    for (const copied of [copiedCatalog, copiedReleaseProcess, copiedBrand, copiedLocales,
      copiedEmptyHero, copiedHeroShell, copiedClientBuildEnvironment, copiedImageLightbox,
      copiedMessageImage, copiedImageLightboxCss, copiedAttachmentLabels, copiedCodeBlock,
      copiedCodeBlockCss, copiedMarkdownText, copiedStream, copiedSidebarRoot,
      copiedSlots, copiedApply, copiedInputBar]) {
      await mkdir(dirname(copied), { recursive: true })
    }
    await writeFile(copiedCatalog, await readFile(officialCatalog))
    await writeFile(copiedReleaseProcess, await readFile(officialReleaseProcess))
    await writeFile(copiedBrand, await readFile(officialBrand))
    await writeFile(copiedLocales, await readFile(officialLocales))
    await writeFile(copiedEmptyHero, await readFile(officialEmptyHero))
    await writeFile(copiedHeroShell, await readFile(officialHeroShell))
    await writeFile(copiedClientBuildEnvironment, await readFile(officialClientBuildEnvironment))
    await writeFile(copiedImageLightbox, await readFile(officialImageLightbox))
    await writeFile(copiedMessageImage, await readFile(officialMessageImage))
    await writeFile(copiedImageLightboxCss, await readFile(officialImageLightboxCss))
    await writeFile(copiedAttachmentLabels, await readFile(officialAttachmentLabels))
    await writeFile(copiedCodeBlock, await readFile(officialCodeBlock))
    await writeFile(copiedCodeBlockCss, await readFile(officialCodeBlockCss))
    await writeFile(copiedMarkdownText, await readFile(officialMarkdownText))
    await writeFile(copiedStream, await readFile(officialStream))
    await writeFile(copiedSidebarRoot, await readFile(officialSidebarRoot))
    await writeFile(copiedSlots, await readFile(officialSlots))
    await writeFile(copiedApply, await readFile(officialApply))
    await writeFile(copiedInputBar, await readFile(officialInputBar))

    const applied = await applyTrackedUpstreamPatches(copiedRoot, patchRoot)

    assert.deepEqual(applied.map((entry) => entry.path), [
      '0001-register-video-analysis-input-session-event.patch',
      '0002-launch-package-manager-shims-on-windows.patch',
      '0003-rebrand-ldd.patch',
      '0004-rebrand-ldd-trim.patch',
      '0005-generate-model-slot.patch',
      '0006-image-download-button.patch',
      '0015-collapse-long-code-blocks.patch',
      '0016-collapse-long-plain-text.patch',
      '0022-kie-llm-finish-reason.patch',
    ])

    // 0001: the video analysis event name is registered in the known-type set.
    const catalog = await readFile(copiedCatalog, 'utf8')
    assert.match(catalog, /'video\/analysis-input'/)

    // 0002: Windows package-manager shims route pnpm/npm through cmd.exe.
    const releaseModule = await import(pathToFileURL(copiedReleaseProcess).href) as Record<string, unknown>
    const candidate = releaseModule.resolveSpawnInvocation
    assert.equal(typeof candidate, 'function')
    const resolveSpawnInvocation = candidate as (
      command: string,
      args: readonly string[],
      platform: NodeJS.Platform,
      environment: Readonly<NodeJS.ProcessEnv>,
    ) => { readonly command: string; readonly args: readonly string[] }
    assert.deepEqual(resolveSpawnInvocation('pnpm', ['--version'], 'win32', {
      ComSpec: 'C:\\Windows\\System32\\cmd.exe',
    }), {
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', 'pnpm.cmd', '--version'],
    })

    // 0003: the LDD wordmark replaces the fish in the hero + sidebar brand.
    const brand = await readFile(copiedBrand, 'utf8')
    assert.match(brand, /LDD_WORDMARK_PATH/u)
    assert.doesNotMatch(brand, /FishLogo/u)
    const emptyHero = await readFile(copiedEmptyHero, 'utf8')
    assert.match(emptyHero, /LDD_WORDMARK_PATH/u)
    assert.doesNotMatch(emptyHero, /HERO_SWIM_UP_PATH/u)
    const heroShell = await readFile(copiedHeroShell, 'utf8')
    assert.doesNotMatch(heroShell, /hero-fish-swim/u)
    const locales = await readFile(copiedLocales, 'utf8')
    assert.match(locales, /'hero\.headline': 'LDD'/u)
    assert.doesNotMatch(locales, /探索未至之境/u)

    // 0004: the client title is LDD, not "DeepSeek Harness".
    const buildEnvironment = await readFile(copiedClientBuildEnvironment, 'utf8')
    assert.match(buildEnvironment, /DSH_CLIENT_TITLE: 'LDD'/u)
    assert.doesNotMatch(buildEnvironment, /DeepSeek Harness/u)

    // 0004 (continued): sidebar brand name dropped (mark only), hero title/preview dropped.
    const sidebarRoot = await readFile(copiedSidebarRoot, 'utf8')
    assert.doesNotMatch(sidebarRoot, /sidebar\.brand\.name/u)
    assert.doesNotMatch(sidebarRoot, /localBuildVersion/u)
    assert.doesNotMatch(emptyHero, /titleGroup/u)
    assert.match(emptyHero, /const height = 48/u)

    // 0005: a dedicated generate-model seat (slots + apply + InputBar) so the
    // stock model seat stays the harness-native LLM selector.
    const slots = await readFile(copiedSlots, 'utf8')
    assert.match(slots, /'conversation\.input\.generate-model'/u)
    const applyMod = await readFile(copiedApply, 'utf8')
    assert.match(applyMod, /'conversation\.input\.generate-model'/u)
    const inputBar = await readFile(copiedInputBar, 'utf8')
    assert.match(inputBar, /conversation\.input\.generate-model/u)

    // 0006: image lightbox gains a save-to-disk download control.
    const imageLightbox = await readFile(copiedImageLightbox, 'utf8')
    assert.match(imageLightbox, /IconDownloadOutline16/u)
    assert.match(imageLightbox, /downloadName\?/u)
    const messageImage = await readFile(copiedMessageImage, 'utf8')
    assert.match(messageImage, /downloadNameFor\(image\)/u)
    const imageLightboxCss = await readFile(copiedImageLightboxCss, 'utf8')
    assert.match(imageLightboxCss, /\.actions \{/u)
    const attachmentLabels = await readFile(copiedAttachmentLabels, 'utf8')
    assert.match(attachmentLabels, /download: t\('image\.download'\)/u)
    assert.match(locales, /'image\.download': '下载图片'/u)

    // 0015/0016: long code blocks collapse (line- and char-count gated).
    const codeBlock = await readFile(copiedCodeBlock, 'utf8')
    assert.match(codeBlock, /DEFAULT_CODE_MAX_LINES/u)
    assert.match(codeBlock, /DEFAULT_CODE_MAX_CHARS/u)
    assert.match(codeBlock, /css\.bodyCollapsed/u)
    assert.match(codeBlock, /aria-expanded=\{expanded\}/u)
    const codeBlockCss = await readFile(copiedCodeBlockCss, 'utf8')
    assert.match(codeBlockCss, /\.bodyCollapsed \{/u)
    assert.match(codeBlockCss, /\.expand \{/u)
    const markdownText = await readFile(copiedMarkdownText, 'utf8')
    assert.match(markdownText, /isCollapsiblePlainText/u)
    assert.match(markdownText, /node\.type === 'paragraph'/u)
    assert.match(markdownText, /<CodeBlock/u)

    // 0022: a KIE-style gateway that omits finish_reason but completed its
    // content is a normal stop (or tool-calls), not a TRANSPORT error.
    const stream = await readFile(copiedStream, 'utf8')
    assert.match(stream, /stream ended without finish_reason/i)
    assert.match(stream, /block\.type === 'toolCall'/u)

    // Applying the same patches again must fail (idempotence guard).
    await assert.rejects(
      applyTrackedUpstreamPatches(copiedRoot, patchRoot),
      /does not match the official source/,
    )
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})
