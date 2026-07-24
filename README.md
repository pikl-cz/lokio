<p align="center">
  <img src="logo.png" alt="Lokio logo" width="200" />
</p>

<h1 align="center">Lokio</h1>

<p align="center">A TypeScript-first SDK for building local-first applications.</p>

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full design and roadmap.

## Getting started

```sh
yarn install
yarn build
yarn test
```

## Packages

This is a Yarn workspaces monorepo:

- [`@lokio/types`](packages/types) - shared TypeScript types
- [`@lokio/core`](packages/core) - workspace/file/directory abstractions, adapter interface, events, plugins
- [`@lokio/browser`](packages/browser) - adapter backed by the File System Access API
- [`@lokio/node`](packages/node) - adapter backed by `fs/promises`
- [`@lokio/cli`](packages/cli) - developer tooling (`lokio init|doctor|info|build`)
- [`@lokio/testing`](packages/testing) - in-memory adapter and test helpers

## Example

```ts
import { Lokio } from "@lokio/core";
import { NodeAdapter } from "@lokio/node";

const workspace = await Lokio.openWorkspace(new NodeAdapter({ root: "./my-workspace" }));

const file = await workspace.open("dreams/today.dream");
await file.write("Today I dreamed about...");
```

## Scripts

- `yarn build` - build all packages (tsup, ESM + type declarations)
- `yarn dev` - build all packages in watch mode
- `yarn test` / `yarn test:watch` - run the Vitest suite
- `yarn typecheck` - run `tsc --noEmit` in every package
- `yarn clean` - remove build output
