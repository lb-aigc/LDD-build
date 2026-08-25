import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

import { applyTrackedUpstreamPatches } from '../src/upstream-patches.ts'

const repositoryRoot = resolve(import.meta.dirname, '..', '..', '..')
const officialCatalog = join(
  repositoryRoot,
  'upstream',
  'deepseek-harness',
  'packages',
  'core',
  'session',
  'src',
  'known-event-types.ts',
)
const officialReleaseProcess = join(
  repositoryRoot,
  'upstream',
  'deepseek-harness',
  'scripts',
  'release',
  'process.ts',
)
const officialBrand = join(
  repositoryRoot,
  'upstream',
  'deepseek-harness',
  'packages',
  'client',
  'ui-brand-official',
  'src',
  'client',
  'Brand.tsx',
)
const officialLocales = join(
  repositoryRoot,
  'upstream',
  'deepseek-harness',
  'packages',
  'client',
  'ui-conversation',
  'src',
  'client',
  'locales.ts',
)
const officialHeroShell = join(
  repositoryRoot,
  'upstream',
  'deepseek-harness',
  'packages',
  'client',
  'ui-conversation',
  'src',
  'client',
  'skeleton',
  'HeroShell.module.css',
)
const officialSidebarRoot = join(
  repositoryRoot,
  'upstream',
  'deepseek-harness',
  'packages',
  'client',
  'ui-sidebar',
  'src',
  'client',
  'SidebarRoot.tsx',
)
const officialEmptyHero = join(
  repositoryRoot,
  'upstream',
  'deepseek-harness',
  'packages',
  'client',
  'ui-conversation',
  'src',
  'client',
  'skeleton',
  'EmptyHero.tsx',
)
const officialClientBuildEnvironment = join(
  repositoryRoot,
  'upstream',
  'deepseek-harness',
  'scripts',
  'client-build-environment.ts',
)
const officialToolSlots = join(
  repositoryRoot,
  'upstream', 'deepseek-harness', 'packages', 'client', 'ui-tool', 'src', 'client', 'contract', 'slots.ts',
)
const officialToolCallTree = join(
  repositoryRoot,
  'upstream', 'deepseek-harness', 'packages', 'client', 'ui-tool', 'src', 'client', 'tool', 'ToolCallTree.tsx',
)
const officialToolCallModel = join(
  repositoryRoot,
  'upstream', 'deepseek-harness', 'packages', 'client', 'ui-tool', 'src', 'client', 'tool', 'models', 'tool-call-model.ts',
)
const officialGenericToolCard = join(
  repositoryRoot,
  'upstream', 'deepseek-harness', 'packages', 'client', 'ui-tool', 'src', 'client', 'tool', 'toolviews', 'GenericToolCard.tsx',
)
const officialImageLightbox = join(
  repositoryRoot,
  'upstream', 'deepseek-harness', 'packages', 'client', 'ui-attachment', 'src', 'ImageLightbox.tsx',
)
const officialMessageImage = join(
  repositoryRoot,
  'upstream', 'deepseek-harness', 'packages', 'client', 'ui-attachment', 'src', 'MessageImage.tsx',
)
const officialImageLightboxCss = join(
  repositoryRoot,
  'upstream', 'deepseek-harness', 'packages', 'client', 'ui-attachment', 'src', 'ImageLightbox.module.css',
)
const officialAttachmentLabels = join(
  repositoryRoot,
  'upstream', 'deepseek-harness', 'packages', 'client', 'ui-attachment', 'src', 'client', 'labels.ts',
)
const officialDeleteCoordinator = join(
  repositoryRoot,
  'upstream', 'deepseek-harness', 'packages', 'session', 'session-persistence', 'src', 'coordinator.ts',
)
const officialDeletePersistenceIndex = join(
  repositoryRoot,
  'upstream', 'deepseek-harness', 'packages', 'session', 'session-persistence', 'src', 'index.ts',
)
const officialDeleteJsonlIndex = join(
  repositoryRoot,
  'upstream', 'deepseek-harness', 'packages', 'session', 'session-persistence-jsonl', 'src', 'index.ts',
)
const officialDeleteSqliteIndex = join(
  repositoryRoot,
  'upstream', 'deepseek-harness', 'packages', 'session', 'session-persistence-sqlite', 'src', 'index.ts',
)
const officialDeleteSqliteStore = join(
  repositoryRoot,
  'upstream', 'deepseek-harness', 'packages', 'session', 'session-persistence-sqlite', 'src', 'store.ts',
)
const officialDeleteSessionsApi = join(
  repositoryRoot,
  'upstream', 'deepseek-harness', 'packages', 'host', 'apiproxy', 'src', 'api', 'sessions.ts',
)
const officialDeleteRpcMap = join(
  repositoryRoot,
  'upstream', 'deepseek-harness', 'packages', 'host', 'apiproxy', 'src', 'api', 'rpc-map.ts',
)
const officialDeleteSessionsSchema = join(
  repositoryRoot,
  'upstream', 'deepseek-harness', 'packages', 'host', 'apiproxy', 'src', 'api', 'sessions.schema.ts',
)
const officialDeleteApiProxy = join(
  repositoryRoot,
  'upstream', 'deepseek-harness', 'packages', 'host', 'apiproxy', 'src', 'api-proxy.ts',
)
const officialDeleteClient = join(
  repositoryRoot,
  'upstream', 'deepseek-harness', 'packages', 'host', 'apiproxy', 'src', 'fetch', 'client.ts',
)
const officialDeleteHandler = join(
  repositoryRoot,
  'upstream', 'deepseek-harness', 'packages', 'host', 'apiproxy', 'src', 'fetch', 'handler.ts',
)
const officialDeleteClientHandlerSpec = join(
  repositoryRoot,
  'upstream', 'deepseek-harness', 'packages', 'host', 'apiproxy', 'tests', 'client-handler.spec.ts',
)
const officialDeleteConnectionFake = join(
  repositoryRoot,
  'upstream', 'deepseek-harness', 'packages', 'client', 'connection', 'tests', 'fake-api.client.ts',
)
const officialDeleteRuntimeFake = join(
  repositoryRoot,
  'upstream', 'deepseek-harness', 'packages', 'client', 'runtime', 'tests', 'fake-api.client.ts',
)
const officialDeleteWorkspacesContract = join(
  repositoryRoot,
  'upstream', 'deepseek-harness', 'packages', 'client', 'runtime', 'src', 'client', 'contract', 'workspaces.ts',
)
const officialDeleteWorkspacesManager = join(
  repositoryRoot,
  'upstream', 'deepseek-harness', 'packages', 'client', 'runtime', 'src', 'client', 'workspaces', 'manager.ts',
)
const officialDeleteWorkspacesService = join(
  repositoryRoot,
  'upstream', 'deepseek-harness', 'packages', 'client', 'runtime', 'src', 'client', 'workspaces', 'service.ts',
)
const officialDeleteWorkspaceSlots = join(
  repositoryRoot,
  'upstream', 'deepseek-harness', 'packages', 'client', 'ui-workspace', 'src', 'client', 'contract', 'slots.ts',
)
const officialDeleteWorkspaceIndex = join(
  repositoryRoot,
  'upstream', 'deepseek-harness', 'packages', 'client', 'ui-workspace', 'src', 'client', 'index.ts',
)
const officialDeleteWorkspaceBrowser = join(
  repositoryRoot,
  'upstream', 'deepseek-harness', 'packages', 'client', 'ui-workspace', 'src', 'client', 'WorkspaceBrowser.tsx',
)
const officialDeleteRows = join(
  repositoryRoot,
  'upstream', 'deepseek-harness', 'packages', 'client', 'ui-workspace', 'src', 'client', 'rows', 'Rows.tsx',
)
const officialDeleteWorkspaceLocales = join(
  repositoryRoot,
  'upstream', 'deepseek-harness', 'packages', 'client', 'ui-workspace', 'src', 'client', 'locales.ts',
)
const patchRoot = join(repositoryRoot, 'patches', 'deepseek-harness', '0.1.1-rc.2')

test('tracked Harness patches add LDD compatibility changes and apply exactly once', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'ldd-upstream-patch-'))
  try {
    const copiedRoot = join(parent, 'source')
    const copiedCatalog = join(
      copiedRoot,
      'packages',
      'core',
      'session',
      'src',
      'known-event-types.ts',
    )
    const copiedReleaseProcess = join(copiedRoot, 'scripts', 'release', 'process.ts')
    const copiedBrand = join(
      copiedRoot, 'packages', 'client', 'ui-brand-official', 'src', 'client', 'Brand.tsx',
    )
    const copiedLocales = join(
      copiedRoot, 'packages', 'client', 'ui-conversation', 'src', 'client', 'locales.ts',
    )
    const copiedHeroShell = join(
      copiedRoot, 'packages', 'client', 'ui-conversation', 'src', 'client', 'skeleton', 'HeroShell.module.css',
    )
    const copiedSidebarRoot = join(
      copiedRoot, 'packages', 'client', 'ui-sidebar', 'src', 'client', 'SidebarRoot.tsx',
    )
    const copiedEmptyHero = join(
      copiedRoot, 'packages', 'client', 'ui-conversation', 'src', 'client', 'skeleton', 'EmptyHero.tsx',
    )
    const copiedClientBuildEnvironment = join(
      copiedRoot, 'scripts', 'client-build-environment.ts',
    )
    const copiedToolSlots = join(
      copiedRoot, 'packages', 'client', 'ui-tool', 'src', 'client', 'contract', 'slots.ts',
    )
    const copiedToolCallTree = join(
      copiedRoot, 'packages', 'client', 'ui-tool', 'src', 'client', 'tool', 'ToolCallTree.tsx',
    )
    const copiedToolCallModel = join(
      copiedRoot, 'packages', 'client', 'ui-tool', 'src', 'client', 'tool', 'models', 'tool-call-model.ts',
    )
    const copiedGenericToolCard = join(
      copiedRoot, 'packages', 'client', 'ui-tool', 'src', 'client', 'tool', 'toolviews', 'GenericToolCard.tsx',
    )
    const copiedImageLightbox = join(
      copiedRoot, 'packages', 'client', 'ui-attachment', 'src', 'ImageLightbox.tsx',
    )
    const copiedMessageImage = join(
      copiedRoot, 'packages', 'client', 'ui-attachment', 'src', 'MessageImage.tsx',
    )
    const copiedImageLightboxCss = join(
      copiedRoot, 'packages', 'client', 'ui-attachment', 'src', 'ImageLightbox.module.css',
    )
    const copiedAttachmentLabels = join(
      copiedRoot, 'packages', 'client', 'ui-attachment', 'src', 'client', 'labels.ts',
    )
    const copiedDeleteCoordinator = join(
      copiedRoot, 'packages', 'session', 'session-persistence', 'src', 'coordinator.ts',
    )
    const copiedDeletePersistenceIndex = join(
      copiedRoot, 'packages', 'session', 'session-persistence', 'src', 'index.ts',
    )
    const copiedDeleteJsonlIndex = join(
      copiedRoot, 'packages', 'session', 'session-persistence-jsonl', 'src', 'index.ts',
    )
    const copiedDeleteSqliteIndex = join(
      copiedRoot, 'packages', 'session', 'session-persistence-sqlite', 'src', 'index.ts',
    )
    const copiedDeleteSqliteStore = join(
      copiedRoot, 'packages', 'session', 'session-persistence-sqlite', 'src', 'store.ts',
    )
    const copiedDeleteSessionsApi = join(
      copiedRoot, 'packages', 'host', 'apiproxy', 'src', 'api', 'sessions.ts',
    )
    const copiedDeleteRpcMap = join(
      copiedRoot, 'packages', 'host', 'apiproxy', 'src', 'api', 'rpc-map.ts',
    )
    const copiedDeleteSessionsSchema = join(
      copiedRoot, 'packages', 'host', 'apiproxy', 'src', 'api', 'sessions.schema.ts',
    )
    const copiedDeleteApiProxy = join(
      copiedRoot, 'packages', 'host', 'apiproxy', 'src', 'api-proxy.ts',
    )
    const copiedDeleteClient = join(
      copiedRoot, 'packages', 'host', 'apiproxy', 'src', 'fetch', 'client.ts',
    )
    const copiedDeleteHandler = join(
      copiedRoot, 'packages', 'host', 'apiproxy', 'src', 'fetch', 'handler.ts',
    )
    const copiedDeleteClientHandlerSpec = join(
      copiedRoot, 'packages', 'host', 'apiproxy', 'tests', 'client-handler.spec.ts',
    )
    const copiedDeleteConnectionFake = join(
      copiedRoot, 'packages', 'client', 'connection', 'tests', 'fake-api.client.ts',
    )
    const copiedDeleteRuntimeFake = join(
      copiedRoot, 'packages', 'client', 'runtime', 'tests', 'fake-api.client.ts',
    )
    const copiedDeleteWorkspacesContract = join(
      copiedRoot, 'packages', 'client', 'runtime', 'src', 'client', 'contract', 'workspaces.ts',
    )
    const copiedDeleteWorkspacesManager = join(
      copiedRoot, 'packages', 'client', 'runtime', 'src', 'client', 'workspaces', 'manager.ts',
    )
    const copiedDeleteWorkspacesService = join(
      copiedRoot, 'packages', 'client', 'runtime', 'src', 'client', 'workspaces', 'service.ts',
    )
    const copiedDeleteWorkspaceSlots = join(
      copiedRoot, 'packages', 'client', 'ui-workspace', 'src', 'client', 'contract', 'slots.ts',
    )
    const copiedDeleteWorkspaceIndex = join(
      copiedRoot, 'packages', 'client', 'ui-workspace', 'src', 'client', 'index.ts',
    )
    const copiedDeleteWorkspaceBrowser = join(
      copiedRoot, 'packages', 'client', 'ui-workspace', 'src', 'client', 'WorkspaceBrowser.tsx',
    )
    const copiedDeleteRows = join(
      copiedRoot, 'packages', 'client', 'ui-workspace', 'src', 'client', 'rows', 'Rows.tsx',
    )
    const copiedDeleteWorkspaceLocales = join(
      copiedRoot, 'packages', 'client', 'ui-workspace', 'src', 'client', 'locales.ts',
    )
    await mkdir(dirname(copiedCatalog), { recursive: true })
    await mkdir(dirname(copiedReleaseProcess), { recursive: true })
    await mkdir(dirname(copiedBrand), { recursive: true })
    await mkdir(dirname(copiedLocales), { recursive: true })
    await mkdir(dirname(copiedHeroShell), { recursive: true })
    await mkdir(dirname(copiedSidebarRoot), { recursive: true })
    await mkdir(dirname(copiedEmptyHero), { recursive: true })
    await mkdir(dirname(copiedClientBuildEnvironment), { recursive: true })
    await mkdir(dirname(copiedToolSlots), { recursive: true })
    await mkdir(dirname(copiedToolCallTree), { recursive: true })
    await mkdir(dirname(copiedToolCallModel), { recursive: true })
    await mkdir(dirname(copiedGenericToolCard), { recursive: true })
    await mkdir(dirname(copiedImageLightbox), { recursive: true })
    await mkdir(dirname(copiedMessageImage), { recursive: true })
    await mkdir(dirname(copiedImageLightboxCss), { recursive: true })
    await mkdir(dirname(copiedAttachmentLabels), { recursive: true })
    await mkdir(dirname(copiedDeleteCoordinator), { recursive: true })
    await mkdir(dirname(copiedDeletePersistenceIndex), { recursive: true })
    await mkdir(dirname(copiedDeleteJsonlIndex), { recursive: true })
    await mkdir(dirname(copiedDeleteSqliteIndex), { recursive: true })
    await mkdir(dirname(copiedDeleteSqliteStore), { recursive: true })
    await mkdir(dirname(copiedDeleteSessionsApi), { recursive: true })
    await mkdir(dirname(copiedDeleteRpcMap), { recursive: true })
    await mkdir(dirname(copiedDeleteSessionsSchema), { recursive: true })
    await mkdir(dirname(copiedDeleteApiProxy), { recursive: true })
    await mkdir(dirname(copiedDeleteClient), { recursive: true })
    await mkdir(dirname(copiedDeleteHandler), { recursive: true })
    await mkdir(dirname(copiedDeleteClientHandlerSpec), { recursive: true })
    await mkdir(dirname(copiedDeleteConnectionFake), { recursive: true })
    await mkdir(dirname(copiedDeleteRuntimeFake), { recursive: true })
    await mkdir(dirname(copiedDeleteWorkspacesContract), { recursive: true })
    await mkdir(dirname(copiedDeleteWorkspacesManager), { recursive: true })
    await mkdir(dirname(copiedDeleteWorkspacesService), { recursive: true })
    await mkdir(dirname(copiedDeleteWorkspaceSlots), { recursive: true })
    await mkdir(dirname(copiedDeleteWorkspaceIndex), { recursive: true })
    await mkdir(dirname(copiedDeleteWorkspaceBrowser), { recursive: true })
    await mkdir(dirname(copiedDeleteRows), { recursive: true })
    await mkdir(dirname(copiedDeleteWorkspaceLocales), { recursive: true })
    await writeFile(copiedCatalog, await readFile(officialCatalog))
    await writeFile(copiedReleaseProcess, await readFile(officialReleaseProcess))
    await writeFile(copiedBrand, await readFile(officialBrand))
    await writeFile(copiedLocales, await readFile(officialLocales))
    await writeFile(copiedHeroShell, await readFile(officialHeroShell))
    await writeFile(copiedSidebarRoot, await readFile(officialSidebarRoot))
    await writeFile(copiedEmptyHero, await readFile(officialEmptyHero))
    await writeFile(copiedClientBuildEnvironment, await readFile(officialClientBuildEnvironment))
    await writeFile(copiedToolSlots, await readFile(officialToolSlots))
    await writeFile(copiedToolCallTree, await readFile(officialToolCallTree))
    await writeFile(copiedToolCallModel, await readFile(officialToolCallModel))
    await writeFile(copiedGenericToolCard, await readFile(officialGenericToolCard))
    await writeFile(copiedImageLightbox, await readFile(officialImageLightbox))
    await writeFile(copiedMessageImage, await readFile(officialMessageImage))
    await writeFile(copiedImageLightboxCss, await readFile(officialImageLightboxCss))
    await writeFile(copiedAttachmentLabels, await readFile(officialAttachmentLabels))
    await writeFile(copiedDeleteCoordinator, await readFile(officialDeleteCoordinator))
    await writeFile(copiedDeletePersistenceIndex, await readFile(officialDeletePersistenceIndex))
    await writeFile(copiedDeleteJsonlIndex, await readFile(officialDeleteJsonlIndex))
    await writeFile(copiedDeleteSqliteIndex, await readFile(officialDeleteSqliteIndex))
    await writeFile(copiedDeleteSqliteStore, await readFile(officialDeleteSqliteStore))
    await writeFile(copiedDeleteSessionsApi, await readFile(officialDeleteSessionsApi))
    await writeFile(copiedDeleteRpcMap, await readFile(officialDeleteRpcMap))
    await writeFile(copiedDeleteSessionsSchema, await readFile(officialDeleteSessionsSchema))
    await writeFile(copiedDeleteApiProxy, await readFile(officialDeleteApiProxy))
    await writeFile(copiedDeleteClient, await readFile(officialDeleteClient))
    await writeFile(copiedDeleteHandler, await readFile(officialDeleteHandler))
    await writeFile(copiedDeleteClientHandlerSpec, await readFile(officialDeleteClientHandlerSpec))
    await writeFile(copiedDeleteConnectionFake, await readFile(officialDeleteConnectionFake))
    await writeFile(copiedDeleteRuntimeFake, await readFile(officialDeleteRuntimeFake))
    await writeFile(copiedDeleteWorkspacesContract, await readFile(officialDeleteWorkspacesContract))
    await writeFile(copiedDeleteWorkspacesManager, await readFile(officialDeleteWorkspacesManager))
    await writeFile(copiedDeleteWorkspacesService, await readFile(officialDeleteWorkspacesService))
    await writeFile(copiedDeleteWorkspaceSlots, await readFile(officialDeleteWorkspaceSlots))
    await writeFile(copiedDeleteWorkspaceIndex, await readFile(officialDeleteWorkspaceIndex))
    await writeFile(copiedDeleteWorkspaceBrowser, await readFile(officialDeleteWorkspaceBrowser))
    await writeFile(copiedDeleteRows, await readFile(officialDeleteRows))
    await writeFile(copiedDeleteWorkspaceLocales, await readFile(officialDeleteWorkspaceLocales))

    const applied = await applyTrackedUpstreamPatches(copiedRoot, patchRoot)
    const result = await readFile(copiedCatalog, 'utf8')
    assert.match(result, /'video\/analysis-input'/)
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
    assert.deepEqual(applied.map((entry) => entry.path), [
      '0001-register-video-analysis-input-session-event.patch',
      '0002-launch-package-manager-shims-on-windows.patch',
      '0003-rebrand-ldd.patch',
      '0004-rebrand-ldd-trim.patch',
      '0005-render-tool-result-images.patch',
      '0006-image-download-button.patch',
      '0007-delete-session.patch',
    ])
    const brand = await readFile(copiedBrand, 'utf8')
    assert.match(brand, /LDD_WORDMARK_PATH/u)
    assert.match(brand, /size >= 34 \? 48 : 18/u)
    assert.doesNotMatch(brand, /FishLogo/u)
    const locales = await readFile(copiedLocales, 'utf8')
    assert.match(locales, /'hero\.headline': 'LDD'/u)
    assert.doesNotMatch(locales, /探索未至之境/u)
    const heroShell = await readFile(copiedHeroShell, 'utf8')
    assert.match(heroShell, /\.headline \{[\s\S]*?display: flex/u)
    assert.doesNotMatch(heroShell, /grid-template-columns/u)
    const sidebarRoot = await readFile(copiedSidebarRoot, 'utf8')
    assert.doesNotMatch(sidebarRoot, /sidebar\.brand\.name/u)
    assert.match(sidebarRoot, /sidebar\.brand\.mark/u)
    const emptyHero = await readFile(copiedEmptyHero, 'utf8')
    assert.doesNotMatch(emptyHero, /hero\.headline/u)
    assert.doesNotMatch(emptyHero, /hero\.preview/u)
    const buildEnvironment = await readFile(copiedClientBuildEnvironment, 'utf8')
    assert.match(buildEnvironment, /DSH_CLIENT_TITLE: 'LDD'/u)
    assert.doesNotMatch(buildEnvironment, /DeepSeek Harness/u)
    const toolSlots = await readFile(copiedToolSlots, 'utf8')
    assert.match(toolSlots, /renderMessageImages\?: RenderMessageImages/u)
    const toolCallModel = await readFile(copiedToolCallModel, 'utf8')
    assert.match(toolCallModel, /block\.type !== 'image'/u)
    const genericToolCard = await readFile(copiedGenericToolCard, 'utf8')
    assert.match(genericToolCard, /renderMessageImages\?\.\(\{ images, align: 'start' \}\)/u)
    const imageLightbox = await readFile(copiedImageLightbox, 'utf8')
    assert.match(imageLightbox, /IconDownloadOutline16/u)
    assert.match(imageLightbox, /downloadName\?/u)
    const messageImage = await readFile(copiedMessageImage, 'utf8')
    assert.match(messageImage, /downloadNameFor\(attachment\)/u)
    const imageLightboxCss = await readFile(copiedImageLightboxCss, 'utf8')
    const deleteCoordinator = await readFile(copiedDeleteCoordinator, 'utf8')
    assert.match(deleteCoordinator, /erase\?\(id: SessionId/u)
    assert.match(deleteCoordinator, /delete\(id: SessionId, signal\?: AbortSignal\)/u)
    const deleteApiProxy = await readFile(copiedDeleteApiProxy, 'utf8')
    assert.match(deleteApiProxy, /async delete\(request\)/u)
    assert.match(deleteApiProxy, /agentHandles\.get\(sessionId\)/u)
    const deleteRows = await readFile(copiedDeleteRows, 'utf8')
    assert.match(deleteRows, /menu\.deleteSession/u)
    assert.match(deleteRows, /onDelete\(node\.id\)/u)
    const deleteLocales = await readFile(copiedDeleteWorkspaceLocales, 'utf8')
    assert.match(deleteLocales, /'menu\.deleteSession': '删除会话'/u)
    const deleteClient = await readFile(copiedDeleteClient, 'utf8')
    assert.match(deleteClient, /'session\.delete': sessionDeleteValueSchema/u)

    assert.match(imageLightboxCss, /\.actions \{/u)
    const attachmentLabels = await readFile(copiedAttachmentLabels, 'utf8')
    assert.match(attachmentLabels, /download: t\('image\.download'\)/u)
    const localesDownload = await readFile(copiedLocales, 'utf8')
    assert.match(localesDownload, /'image\.download': '下载图片'/u)
    await assert.rejects(
      applyTrackedUpstreamPatches(copiedRoot, patchRoot),
      /does not match the official source/,
    )
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})
