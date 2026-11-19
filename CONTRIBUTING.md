# Contributing to Lokio

Thanks for your interest! Bug reports, docs fixes, adapters and plugins are all welcome.

## Setup

Requirements: Node.js ≥ 20 and [pnpm](https://pnpm.io) (the version is pinned in `package.json` → `packageManager`; `corepack enable` picks it up).

```sh
pnpm install
pnpm check      # lint + typecheck + tests with coverage + build - the same as CI
```

Useful scripts:

| Script               | What it does                                              |
| -------------------- | --------------------------------------------------------- |
| `pnpm test`          | Run all unit tests (Vitest, against sources - no build)   |
| `pnpm test:watch`    | Watch mode                                                |
| `pnpm test:coverage` | Tests + coverage report in `coverage/` (thresholds in CI) |
| `pnpm typecheck`     | `tsc` per package, with each package's own `lib`/`types`  |
| `pnpm lint`          | Biome lint + format check; `pnpm format` fixes            |
| `pnpm build`         | Build every package (tsup → ESM + `.d.ts`), in dep order  |
| `pnpm dev`           | Rebuild all packages on change                            |

## Repository layout

```
packages/
  types/        shared types (no runtime code)
  core/         workspace, files, directories, events, locks, plugin API - runtime-agnostic
  node/         fs/promises adapter
  browser/      File System Access API / OPFS adapter
  auto/         runtime detection (openWorkspace())
  testing/      MemoryAdapter, adapter conformance suite, fake File System Access API
  cli/          the `lokio` command
  plugin-*/     official plugins
examples/       runnable examples
```

## Guidelines

- **Core stays runtime-agnostic.** No `node:*` imports, no `window`. Package tsconfigs enforce this: core,
  types, testing and plugins compile without Node types.
- **Adapters must pass the conformance suite** (`describeAdapterConformance` from
  `@lokio/testing/conformance`). If you change adapter semantics, add a check to
  `packages/testing/src/checks.ts` so every adapter is held to it.
- **Errors are Lokio errors** with a stable `code`. Never leak raw `ENOENT` / `DOMException`s.
- **Tests are required** for bug fixes and features. Coverage thresholds are enforced in CI.
- **Small, tree-shakeable modules**, no runtime dependencies unless discussed first.

## Commits and releases

We use [Changesets](https://github.com/changesets/changesets). If your PR changes a published package, run
`pnpm changeset`, choose the packages and bump type, and commit the generated file. Maintainers merge the
"Version Packages" PR to release.

While we're on `0.x`, minor versions may contain breaking changes - call them out in the changeset.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Be kind.
