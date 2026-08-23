# Portable Harness Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make both LDD runtime installation paths produce a regular-file-only portable dependency tree and add an early full-repository release gate.

**Architecture:** Centralize pnpm 11 portable-runtime workspace generation in `@ldd/runtime-package`, then use it from the offline runtime builder and the desktop online installer. Keep the manifest security boundary unchanged and make CI run tests and type checks before packaging.

**Tech Stack:** Node.js 24.19.0, TypeScript 6, pnpm 11.7.0, Node test runner, Vitest, GitHub Actions, Electron Builder.

**Spec:** `docs/superpowers/specs/2026-08-23-portable-runtime.md`

## Global Constraints

- Target Windows 10/11 x64.
- Keep Node.js pinned to 24.19.0 and pnpm pinned to 11.7.0.
- Do not permit symbolic links in runtime manifests or archives.
- Do not broaden lifecycle-script permissions.

---

### Task 1: Central portable pnpm workspace writer

**Files:**
- Create: `packages/runtime-package/src/pnpm-runtime-config.ts`
- Modify: `packages/runtime-package/src/index.ts`
- Test: `packages/runtime-package/tests/pnpm-runtime-config.verify.ts`

**Interfaces:**
- Produces: `writePortableRuntimePnpmConfig(root, allowBuilds): Promise<void>`.
- Produces `pnpm-workspace.yaml` with portable linker settings and sorted lifecycle policy.

- [ ] **Step 1: Write the failing test**

Create a temporary runtime root, call the new function, and assert that the
workspace YAML contains camel-case pnpm 11 settings and explicit build policy.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --conditions=source --experimental-strip-types --test packages/runtime-package/tests/pnpm-runtime-config.verify.ts`

Expected: FAIL because the shared writer does not exist.

- [ ] **Step 3: Write minimal implementation**

Write the workspace file atomically enough for a private staging directory,
validate package selectors, sort them with `compareRuntimeNames`, and export the
function from `@ldd/runtime-package`.

- [ ] **Step 4: Run test to verify it passes**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `fix: centralize portable pnpm runtime config`

### Task 2: Use the portable config in both installation paths

**Files:**
- Modify: `packages/runtime-package/src/build-runtime.ts`
- Modify: `apps/desktop/src/main/runtime/online-install.ts`
- Test: `packages/runtime-package/tests/build-assembly.verify.ts`
- Test: `apps/desktop/tests/online-install.verify.ts`

**Interfaces:**
- Consumes: `writePortableRuntimePnpmConfig` from Task 1.
- Preserves the exact tarball build selector for `dsh-subprocess-local`.

- [ ] **Step 1: Write failing integration assertions**

Assert that offline and online staging roots receive the portable workspace
settings and do not put linker settings in `.npmrc`.

- [ ] **Step 2: Run tests to verify they fail**

Run both focused test files and confirm failure is caused by the old `.npmrc`
layout.

- [ ] **Step 3: Replace duplicated configuration writes**

Call the shared writer with each path's existing package-scoped lifecycle
policy. Do not change the manifest link rejection.

- [ ] **Step 4: Run focused tests**

Run both focused test files. Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `fix: install runtimes with hoisted pnpm layout`

### Task 3: Add an early release verification gate

**Files:**
- Modify: `package.json`
- Modify: `.github/workflows/build-windows.yml`
- Modify: `scripts/tests/windows-build-offline.verify.ts`

**Interfaces:**
- Produces: `pnpm verify:release` as the repository-wide pre-packaging gate.

- [ ] **Step 1: Add failing workflow contract assertions**

Assert that the workflow invokes `pnpm verify:release` before `pnpm dist:win`
and that the script runs tests plus type checking.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --conditions=source --test scripts/tests/windows-build-offline.verify.ts`

Expected: FAIL because the gate is absent.

- [ ] **Step 3: Add the verification script and workflow step**

Define `verify:release` as `pnpm test && pnpm typecheck` and invoke it after the
locked dependency install.

- [ ] **Step 4: Run focused test**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `ci: gate Windows packaging on repository verification`

### Task 4: Full verification and source package replacement

**Files:**
- Replace: `release/LDD-0.2.0-source.zip`

**Interfaces:**
- Produces the next version of the existing downloadable source package.

- [ ] **Step 1: Run all tests and type checking**

Run `pnpm test` and `pnpm typecheck`; require zero failures.

- [ ] **Step 2: Run release-specific verification**

Run the runtime assembly, Windows workflow contract, source-package, checksum,
and ZIP integrity checks.

- [ ] **Step 3: Generate and inspect the source archive**

Run `node scripts/package-source.mjs`, test the ZIP, and verify the corrected
workspace settings are present in the archived sources.

- [ ] **Step 4: Commit and replace the existing downloadable file**

Commit the audited source and replace the same persistent file identity.

