# Deterministic Hoisted Runtime Assembly Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved DeepSeek Harness runtime with pnpm as a deterministic, symlink-free flat installation that never mixes registry copies of internal packages and never runs unapproved lifecycle scripts.

**Architecture:** Generate pnpm workspace overrides from the canonical local archive inventory, install with hoisted/copy mode and `--ignore-scripts`, then validate and run a fixed lifecycle allowlist using direct Node invocations and a compact environment. Add real post-install provenance, symlink, artifact, and DSH CLI gates so installer packaging cannot begin after a partial or simulated assembly.

**Tech Stack:** Node.js 24, TypeScript 6, pnpm 11.7, Node test runner, Vitest, Electron Builder, GitHub Actions Windows 2022.

**Spec:** `docs/superpowers/specs/2026-08-23-deterministic-hoisted-runtime-assembly-design.md`

## Global Constraints

- Windows 10/11 x64 is the first supported desktop target.
- The final runtime must contain zero symbolic links.
- Every `@deepseek-ai/*` and `@ldd/*` package must resolve from an approved local `file:packages/*.tgz` archive.
- pnpm remains pinned to `11.7.0`; changing pnpm versions is not part of this fix.
- The final installation must use `nodeLinker: hoisted` and `packageImportMethod: copy`.
- Automatic package lifecycle execution is disabled; only the fixed allowlist in the spec may run.
- Existing signed runtime manifest, updater, rollback, plugin archive, and source provenance formats remain unchanged.
- No release source bundle is created before a real local full runtime assembly passes.
- The Windows installer is not declared fixed until GitHub Actions produces the required EXE artifact.

---

### Task 1: Deterministic Internal-Package Overrides

**Files:**
- Create: `packages/runtime-package/tests/pnpm-runtime-config.spec.ts`
- Modify: `packages/runtime-package/src/pnpm-runtime-config.ts`
- Modify: `packages/runtime-package/src/build-runtime.ts`

**Interfaces:**
- Consumes: canonical runtime dependency record `Readonly<Record<string, string>>`.
- Produces: `writePortableRuntimePnpmConfig(runtimeRoot, allowBuilds, dependencies): Promise<void>` and a workspace file containing sorted local overrides.

- [ ] **Step 1: Write the failing workspace-override tests**

Create tests that write configuration into a temporary directory and assert the literal workspace result includes sorted overrides only for approved internal namespaces:

```ts
await writePortableRuntimePnpmConfig(root, {}, {
  '@ldd/zeta': 'file:packages/ldd-zeta-1.0.0.tgz',
  '@deepseek-ai/alpha': 'file:packages/deepseek-ai-alpha-1.0.0.tgz',
  react: '19.0.0',
})
assert.match(workspace, /^overrides:\n  '@deepseek-ai\/alpha': 'file:packages\/deepseek-ai-alpha-1\.0\.0\.tgz'\n  '@ldd\/zeta': 'file:packages\/ldd-zeta-1\.0\.0\.tgz'$/mu)
assert.doesNotMatch(workspace, /^  'react':/mu)
```

Add rejection cases for an internal registry specifier and an unsafe package name.

- [ ] **Step 2: Run the new test and verify RED**

Run:

```bash
pnpm exec vitest run packages/runtime-package/tests/pnpm-runtime-config.spec.ts
```

Expected: FAIL because `writePortableRuntimePnpmConfig` accepts only two arguments and emits no `overrides` section.

- [ ] **Step 3: Implement minimal override generation**

Extend `writePortableRuntimePnpmConfig` with the dependency record, select names beginning with `@deepseek-ai/` or `@ldd/`, require targets matching `file:packages/[A-Za-z0-9._-]+.tgz`, sort with `compareRuntimeNames`, and emit:

```yaml
overrides:
  '@deepseek-ai/alpha': 'file:packages/deepseek-ai-alpha-1.0.0.tgz'
```

Pass the already generated `dependencies` record from `buildRuntime`.

- [ ] **Step 4: Run targeted tests and type checking**

Run:

```bash
pnpm exec vitest run packages/runtime-package/tests/pnpm-runtime-config.spec.ts
pnpm --filter @ldd/runtime-package typecheck
```

Expected: both commands exit zero.

- [ ] **Step 5: Commit Task 1**

```bash
git add packages/runtime-package/src/pnpm-runtime-config.ts packages/runtime-package/src/build-runtime.ts packages/runtime-package/tests/pnpm-runtime-config.spec.ts
git commit -m "fix: pin internal runtime packages to local archives"
```

---

### Task 2: Fail-Closed Lifecycle Runner

**Files:**
- Create: `packages/runtime-package/src/runtime-lifecycle.ts`
- Create: `packages/runtime-package/tests/runtime-lifecycle.spec.ts`
- Modify: `packages/runtime-package/src/index.ts`

**Interfaces:**
- Consumes: runtime root, controlled base environment, and `BuildCommandRunner`.
- Produces: `runApprovedRuntimeLifecycles(runtimeRoot, environment, run): Promise<void>`.
- Produces: `approvedRuntimeLifecycles`, an immutable ordered list of package, phase, expected script, and direct command steps.

- [ ] **Step 1: Write failing policy and environment tests**

Build small installed package directories in a temporary runtime and assert:

```ts
await runApprovedRuntimeLifecycles(root, { PATH: 'oversized-parent-path', SYSTEMROOT: 'C:\\Windows' }, runner)
assert.deepEqual(calls[0], {
  command: process.execPath,
  args: ['install.js'],
  cwd: join(root, 'node_modules', 'esbuild'),
})
assert.ok(!calls[0].env.PATH?.includes('oversized-parent-path'))
```

Add separate tests proving a missing package, missing lifecycle phase, changed script body, symbolic-link package directory, and unknown allowlist entry are rejected before execution.

- [ ] **Step 2: Run lifecycle tests and verify RED**

Run:

```bash
pnpm exec vitest run packages/runtime-package/tests/runtime-lifecycle.spec.ts
```

Expected: FAIL because the lifecycle module does not exist.

- [ ] **Step 3: Implement the immutable lifecycle policy**

Define the exact commands from the approved spec. Validate each installed `package.json` script body before running. Resolve package directories below `runtimeRoot/node_modules`, reject symlinks with `lstat`, and use `process.execPath` for JavaScript entrypoints. Implement `node-pty` install as two direct steps: run `scripts/prebuild.js`; only on non-zero exit, locate the installed Node-gyp JavaScript entry and run it with `rebuild`.

- [ ] **Step 4: Implement compact lifecycle environments**

Construct `PATH` from the Node executable directory, the runtime's `node_modules/.bin`, and Windows system directories derived from `SYSTEMROOT`; preserve only required temporary-directory, proxy, home, locale, and Windows process variables. Set `CI=1` and `DSH_TELEMETRY_DISABLED=1`. Never inherit `NODE_OPTIONS`, `NODE_PATH`, npm configuration variables, pnpm variables, or the parent `PATH`.

- [ ] **Step 5: Run lifecycle tests and type checking**

Run:

```bash
pnpm exec vitest run packages/runtime-package/tests/runtime-lifecycle.spec.ts
pnpm --filter @ldd/runtime-package typecheck
```

Expected: both commands exit zero.

- [ ] **Step 6: Commit Task 2**

```bash
git add packages/runtime-package/src/runtime-lifecycle.ts packages/runtime-package/src/index.ts packages/runtime-package/tests/runtime-lifecycle.spec.ts
git commit -m "fix: run approved runtime lifecycle scripts safely"
```

---

### Task 3: Real Post-Install Gates in Runtime Assembly

**Files:**
- Create: `packages/runtime-package/src/runtime-install-verification.ts`
- Create: `packages/runtime-package/tests/runtime-install-verification.spec.ts`
- Modify: `packages/runtime-package/src/build-runtime.ts`
- Modify: `packages/runtime-package/src/index.ts`
- Modify: `packages/runtime-package/tests/build-assembly.verify.ts`

**Interfaces:**
- Consumes: runtime root, approved dependency record, plugin package name, and command runner.
- Produces: `verifyInstalledRuntime(runtimeRoot, dependencies, run, environment): Promise<void>`.
- Uses: `runApprovedRuntimeLifecycles` from Task 2.

- [ ] **Step 1: Write failing provenance and symlink tests**

Use hand-written lockfile fixtures to prove verification accepts only local snapshots:

```yaml
packages:
  '@deepseek-ai/cosmokit@file:packages/deepseek-ai-cosmokit-1.8.2.tgz': {}
```

and rejects a second snapshot:

```yaml
packages:
  '@deepseek-ai/cosmokit@1.8.2': {}
```

Add tests that create a symlink in the runtime tree and expect rejection, omit the video plugin or DSH entry and expect rejection, and use a real Node command runner for a minimal DSH `--help` fixture.

- [ ] **Step 2: Run verification tests and verify RED**

Run:

```bash
pnpm exec vitest run packages/runtime-package/tests/runtime-install-verification.spec.ts
```

Expected: FAIL because `verifyInstalledRuntime` does not exist.

- [ ] **Step 3: Implement post-install verification**

Walk the runtime tree with `lstat` and reject every symbolic link. Parse the pnpm lockfile as text using anchored package-snapshot keys derived from the approved dependency names; require the exact local-file key and reject non-file keys. Require regular files for DSH, the video plugin manifest, and supported native artifacts. Execute DSH with:

```ts
await run(process.execPath, [dshEntryPath, '--help'], {
  cwd: runtimeRoot,
  env: smokeEnvironment,
  captureOutput: true,
})
```

- [ ] **Step 4: Integrate script-free install and gates**

Add `--ignore-scripts` to the final runtime pnpm install. Immediately after install, call `runApprovedRuntimeLifecycles`, wire the video plugin into DSH, then call `verifyInstalledRuntime` before writing metadata. Update the assembly fake to assert `--ignore-scripts` and to model the allowlisted lifecycle and DSH smoke invocations instead of silently accepting all commands.

- [ ] **Step 5: Run targeted assembly tests and type checking**

Run:

```bash
pnpm exec vitest run packages/runtime-package/tests/runtime-install-verification.spec.ts packages/runtime-package/tests/runtime-lifecycle.spec.ts packages/runtime-package/tests/pnpm-runtime-config.spec.ts
pnpm --filter @ldd/runtime-package test
pnpm --filter @ldd/runtime-package typecheck
```

Expected: all commands exit zero with no failed tests.

- [ ] **Step 6: Commit Task 3**

```bash
git add packages/runtime-package/src/runtime-install-verification.ts packages/runtime-package/src/runtime-lifecycle.ts packages/runtime-package/src/build-runtime.ts packages/runtime-package/src/index.ts packages/runtime-package/tests/runtime-install-verification.spec.ts packages/runtime-package/tests/build-assembly.verify.ts
git commit -m "fix: verify real Harness runtime installation"
```

---

### Task 4: Release Workflow Gate and Full Regression

**Files:**
- Modify: `.github/workflows/build-windows.yml`
- Modify: `scripts/tests/windows-build-offline.verify.ts`
- Modify: `docs/release-checklist.md`

**Interfaces:**
- Consumes: successful `pnpm dist:win` output.
- Produces: a Windows Actions job that verifies the installed DSH CLI and required artifacts before upload.

- [ ] **Step 1: Write the failing workflow verification**

Extend `windows-build-offline.verify.ts` so it requires a named post-build runtime smoke step before `Upload private build artifacts`, executing the installed runtime's DSH entry with `--help` and checking the runtime archive and EXE.

- [ ] **Step 2: Run workflow verification and verify RED**

Run:

```bash
node scripts/run-node-verifies.mjs scripts/tests/windows-build-offline.verify.ts
```

Expected: FAIL because the workflow has no explicit post-build DSH smoke step.

- [ ] **Step 3: Add the Windows post-build smoke gate**

Insert a PowerShell step after `pnpm dist:win` that resolves the DSH runtime entry under `dist/runtime/0.1.1-rc.2`, runs it with `node ... --help`, and fails on any non-zero exit. Keep the existing release-artifact hashes and upload ordering.

- [ ] **Step 4: Update the release checklist**

Document the local override rule, script-free install, lifecycle allowlist, zero-symlink requirement, lockfile provenance check, DSH CLI smoke test, and GitHub EXE artifact gate.

- [ ] **Step 5: Run repository verification**

Run:

```bash
pnpm verify:release
```

Expected: all type checks, Vitest tests, and Node verification tests exit zero.

- [ ] **Step 6: Run the real full local runtime assembly**

Run the repository's pinned Node 24 and pnpm 11.7 build with Windows-host enforcement disabled only in the local diagnostic entrypoint. Verify the command exits zero, the runtime contains zero symbolic links, every approved internal lockfile snapshot is local, and `dsh --help` exits zero. Do not create a source upload bundle if any check fails.

- [ ] **Step 7: Commit Task 4**

```bash
git add .github/workflows/build-windows.yml scripts/tests/windows-build-offline.verify.ts docs/release-checklist.md
git commit -m "ci: gate Windows release on installed Harness smoke test"
```

- [ ] **Step 8: Prepare GitHub verification handoff**

Generate the next source archive and checksums only after Steps 5 and 6 pass. Push or upload only with the user's existing authorized GitHub workflow. The completion report must distinguish local success from the still-required Windows Actions success and link the resulting Actions run and EXE artifact when available.
