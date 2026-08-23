# Portable Harness Runtime Specification

## Problem

GitHub Actions run `32628227208`, job `97166823317`, completes the Harness
source build, package packing, plugin build, and final dependency installation,
then fails while creating the runtime manifest because the final
`node_modules/.pnpm` tree contains symbolic links.

The runtime archive format intentionally accepts regular files only. The
Windows installer extracts only manifest-covered regular files, so weakening
the manifest rule or archiving links is not acceptable.

## Root cause

The generated runtime writes `node-linker=hoisted`,
`package-import-method=copy`, and `shared-workspace-lockfile=false` to
`.npmrc`. pnpm 11 reads these non-authentication project settings from
`pnpm-workspace.yaml`. The settings are therefore not applied and pnpm uses its
isolated virtual-store link layout.

The same misplaced settings exist in the desktop online runtime installer.

## Required behavior

- Both offline runtime assembly and online runtime installation must generate
  a pnpm 11 workspace with `nodeLinker: hoisted`,
  `packageImportMethod: copy`, `sharedWorkspaceLockfile: false`, and
  `preferSymlinkedExecutables: false`.
- Lifecycle-script allow/deny policy must remain explicit and package-scoped.
- Runtime manifests and archives must continue to reject symbolic links.
- The Windows release workflow must run a repository verification gate before
  the long packaging step and must still verify every required output.
- The existing Windows x64, Node 24.19.0, and pnpm 11.7.0 pins remain unchanged.

