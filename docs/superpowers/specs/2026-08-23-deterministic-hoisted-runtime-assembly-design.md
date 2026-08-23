# Deterministic Hoisted Runtime Assembly Design

## Context

LDD builds the approved DeepSeek Harness source into local package archives and
then assembles a portable Windows runtime. The runtime must contain ordinary
files only because the updater verifies, copies, and rolls back the runtime on
Windows without requiring Developer Mode or symbolic-link privileges.

The current final assembly declares all 238 approved Harness and LDD archives as
top-level `file:packages/*.tgz` dependencies and installs them with pnpm's
`nodeLinker: hoisted` mode. Dependencies inside those archives still use normal
version ranges, so pnpm may resolve a second registry copy of the same package.
For `@deepseek-ai/cosmokit`, pnpm records the registry package in
`node_modules/.modules.yaml` but omits the local-file variant from
`hoistedLocations`, then aborts with
`ERR_PNPM_MISSING_HOISTED_LOCATIONS`.

The previous assembly test replaced the final package-manager invocation with a
fake runner. It verified surrounding orchestration but could not catch a real
pnpm resolution or lifecycle failure.

## Goals

- Assemble the approved Harness runtime as a flat, symlink-free `node_modules`.
- Ensure every `@deepseek-ai/*` and `@ldd/*` package resolves to its approved
  local archive, never to a registry duplicate.
- Prevent pnpm's expanded lifecycle environment from causing Windows
  `spawn EINVAL` or POSIX `spawn E2BIG` failures.
- Run only explicitly approved install lifecycle scripts.
- Add a real, non-mocked assembly gate before Windows installer packaging.
- Preserve the existing signed runtime manifest, updater, rollback, and source
  provenance contracts.

## Non-goals

- Do not change the desktop UI, updater protocol, model configuration, or video
  analysis behavior.
- Do not switch the final package manager to npm.
- Do not ship pnpm's isolated layout or materialize its symbolic links.
- Do not relax runtime manifest validation or permit symbolic links.
- Do not publish any package or repository.

## Chosen Architecture

The final runtime remains a pnpm hoisted installation, but resolution and
lifecycle execution become two explicit phases.

### 1. Deterministic local overrides

The runtime package generator derives an `overrides` map from the same archive
inventory used to create `dependencies`. Every package whose name begins with
`@deepseek-ai/` or `@ldd/` maps to its exact `file:packages/<archive>.tgz`
specifier. The map is emitted in `pnpm-workspace.yaml`, which is the supported
configuration location for pnpm 11.

The generator rejects duplicate package names, missing archives, non-local
override targets, and any internal dependency without a matching approved
archive. The resulting lockfile must contain only local-file snapshots for
approved internal package names.

### 2. Script-free hoisted installation

The final pnpm command retains the existing production, offline preference,
copy import method, and dedicated store settings, and adds `--ignore-scripts`.
This lets pnpm resolve and copy the flat dependency tree without constructing a
large lifecycle `PATH` and environment for every direct package.

### 3. Allowlisted lifecycle runner

After installation, LDD runs lifecycle scripts for this fixed allowlist:

| Package | Phase | Command |
| --- | --- | --- |
| `esbuild` | `postinstall` | `node install.js` |
| `koffi` | `install` | `node ./cnoke.cjs -P . -D src/koffi --prebuild --release` |
| `node-pty` | `install` | `node scripts/prebuild.js`, falling back to the package's documented `node-gyp rebuild` path only when the prebuild probe fails |
| `node-pty` | `postinstall` | `node scripts/post-install.js` |
| `@deepseek-ai/dsh-subprocess-local` | `postinstall` | `node scripts/ensure-spawn-helper.mjs` |

The runner reads the installed package manifest and requires the declared
script to match the approved command before executing it. It launches commands
with the installed Node executable and a minimal environment containing the
Node directory, operating-system command directories, and package-local binary
directory. Unknown packages, phases, or changed script bodies fail closed.

### 4. Assembly verification

The completed runtime is accepted only when all of these checks pass:

1. The real pnpm install exits with code zero.
2. The runtime tree contains no symbolic links.
3. The lockfile contains no registry snapshot for any approved internal package.
4. Required native artifacts and the LDD video plugin are present.
5. `node node_modules/@deepseek-ai/dsh/lib/bin.js --help` exits with code zero.

Only after these gates pass may manifest generation, archive collection,
checksum generation, and Windows installer packaging continue.

## Components and Interfaces

### Runtime pnpm configuration

`packages/runtime-package/src/pnpm-runtime-config.ts` will build the workspace
configuration from the package archive inventory. Its public output includes
the deterministic override map and the existing build policy.

### Lifecycle policy and runner

A focused runtime-package module will own the immutable allowlist, installed
manifest validation, minimal environment construction, process execution, and
actionable error messages. `build-runtime.ts` will orchestrate it after the
script-free install instead of allowing pnpm to run lifecycle scripts during
resolution.

### Real assembly verification

Unit tests will cover override generation, fail-closed lifecycle validation,
and minimal environment construction. A real integration test will build small
local archives that reproduce the local-versus-registry conflict shape, invoke
the installed pnpm executable, and assert a symlink-free result. The release
workflow will also run the complete production assembly and DSH smoke test,
making the GitHub Windows build a final platform gate rather than the first real
test.

## Data Flow

1. Build approved Harness packages and LDD plugin archives.
2. Generate runtime `package.json` dependencies and matching workspace
   overrides from one canonical archive inventory.
3. Run pnpm production install with `--ignore-scripts` and the hoisted/copy
   configuration.
4. Validate and execute the fixed lifecycle allowlist with a minimal process
   environment.
5. Verify lockfile provenance, native artifacts, symlink absence, plugin
   presence, and DSH CLI startup.
6. Generate the signed runtime manifest and package release artifacts.

## Error Handling

- Resolution errors identify the internal package and both competing sources.
- Lifecycle errors identify package, phase, approved command, and exit status.
- A missing or modified lifecycle script is a policy violation, not a warning.
- A symlink, registry-backed internal package, missing native artifact, missing
  plugin, or failed CLI smoke test stops the release before packaging.
- Temporary build directories are removed on both success and failure; cleanup
  failures are reported without hiding the primary build error.

## Testing and Release Gate

Development follows red-green-refactor. The first regression test must fail
against the current fake-only behavior before production code changes. Targeted
tests run after each unit. Before a release source package is produced, the
following fresh commands must all complete successfully:

- runtime-package unit and integration tests;
- TypeScript type checking for changed packages;
- the real full Harness runtime assembly;
- symlink and lockfile provenance verification;
- the DSH CLI smoke test;
- Windows desktop packaging and required-artifact verification in GitHub
  Actions.

No new user upload package is produced until the local real assembly gates pass.
The Windows installer is not described as fixed until the GitHub Windows job
also completes successfully and exposes the expected EXE artifact.
