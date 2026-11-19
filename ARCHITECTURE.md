# Lokio – Architecture

> **Status (v0.1):** Phase 1 is implemented, and Phase 2 partly (history and encryption plugins, CLI), plus a
> search plugin and `@lokio/auto`. The original brief follows; the package READMEs document the actual API.

## Vision

**Lokio** is a TypeScript-first SDK that simplifies building **local-first applications**.

It does **not** define data formats, application architecture, or UI. Instead, it provides a unified API for working with user-owned files and folders across multiple runtimes.

The primary philosophy is:

> **Applications own the data model. Users own the files. Lokio only provides the bridge.**

---

# Core Principles

- TypeScript-first
- Framework agnostic
- Local-first
- Offline-first
- User owns the data
- No proprietary file format
- Extensible through adapters and plugins
- Optional native acceleration (Rust/WASM)
- Optional PWA support

---

# Goals

Lokio should make this simple:

```ts
const workspace = await openWorkspace(); // from @lokio/auto

const file = workspace.file("dreams/today.dream");

await file.write(content);
```

without the application worrying about:

- permissions
- browser APIs
- filesystem abstraction
- future runtime compatibility

---

# What Lokio IS

Lokio is:

- SDK
- Runtime abstraction
- Filesystem abstraction
- Workspace manager
- Extension platform

---

# What Lokio IS NOT

Lokio is NOT:

- a web framework
- a React framework
- a database
- a note-taking application
- a cloud service
- a file format

Applications decide:

- data format
- UI
- business logic
- storage structure

---

# Architecture

```
Application
    │
    │
    ▼

+----------------------+
|      Lokio SDK       |
+----------------------+

 Workspace API
 File API
 Directory API
 Events
 Permissions
 Adapters
 Plugins

    │

+----------------------+
| Runtime Adapter      |
+----------------------+

 Browser
 Node
 Tauri
 Electron
 Future adapters

    │

Filesystem
```

---

# Proposed Repository Structure

```
lokio/

packages/

    core/

    browser/

    node/

    cli/

    testing/

    types/

examples/

    react/

    next/

    vue/

    svelte/

    vanilla/

docs/

tests/
```

---

# Package Responsibilities

## @lokio/core

Contains:

- Workspace abstraction
- File abstraction
- Directory abstraction
- Event system
- Plugin API
- Adapter interfaces
- Error handling

No runtime-specific code.

---

## @lokio/browser

Implements:

- File System Access API

Provides:

```ts
BrowserAdapter;
```

---

## @lokio/node

Implements:

- fs/promises

Allows using Lokio inside:

- Node
- CLI
- Electron
- Tauri backend

---

## @lokio/cli

Developer tooling.

Possible commands:

```
lokio init

lokio doctor

lokio info

lokio build
```

---

## @lokio/testing

Testing helpers.

Examples:

- fake filesystem
- mock adapter
- permission simulator

---

# Plugin Architecture

Every feature should be pluggable.

Example:

```
Lokio

├── Core

├── Browser Adapter

├── Node Adapter

├── Plugin Search

├── Plugin Encryption

├── Plugin History

└── Plugin Backup
```

Plugin interface example:

```ts
interface LokioPlugin {
  name: string;

  setup(app: Lokio): void;
}
```

---

# Adapter Architecture

```
Workspace

↓

Adapter

↓

Browser
Node
Tauri
Electron
```

Applications never communicate directly with runtime APIs.

---

# Optional Extensions

## Rust/WASM

Optional acceleration layer.

Possible use cases:

- indexing
- search
- hashing
- compression
- encryption
- binary parsing

Must remain optional.

TypeScript implementation must always exist.

---

## Progressive Web App

Optional package.

Provides:

- Service Worker
- Offline caching
- Installation support

Should not be part of the Core SDK.

---

## Future Native Support

Potential adapters:

- Tauri
- Electron
- Node
- Bun
- Deno

---

# Use Cases

## Dream Journal

```
.dream
```

Local storage.

---

## Markdown Notes

```
.md
```

No database.

---

## Recipe Manager

```
.json
```

---

## Personal Wiki

```
.md
```

---

## Image Catalog

```
.jpg

.png

metadata.json
```

---

## Project Manager

Developer decides storage layout.

---

# Documentation Requirements

Every package must include:

- installation
- quick start
- API reference
- examples
- best practices
- migration guide (future)

---

# Developer Experience

Installation:

```
npm install @lokio/core
```

or

```
yarn add @lokio/core
```

Minimal example:

```ts
import { Lokio } from "@lokio/core";
```

Developer should be productive within five minutes.

---

# Testing

Testing is mandatory.

Requirements:

- Vitest
- High unit test coverage
- Mock adapters
- Filesystem simulation
- CI ready

Suggested coverage:

- Workspace
- Files
- Directories
- Plugins
- Adapter interface
- Error handling

---

# TypeScript

Requirements:

- Strict mode

```
"strict": true
```

No implicit any.

Generics where appropriate.

Public API fully typed.

Generated declaration files.

ESM-first.

---

# Build

Recommended tooling:

- tsup (or equivalent)
- TypeScript
- npm workspaces

Output:

```
dist/

esm/

types/
```

---

# Coding Standards

- SOLID
- Composition over inheritance
- Small modules
- Tree-shakeable
- No framework dependencies
- Minimal external dependencies

---

# Long-Term Roadmap

## Phase 1

Core SDK

Browser adapter

Node adapter

Testing

Documentation

---

## Phase 2

CLI

Plugin ecosystem

History plugin

Encryption plugin

---

## Phase 3

Rust/WASM acceleration

Search engine

Binary helpers

---

## Phase 4

PWA package

Offline helpers

Installer

---

## Phase 5

Community plugins

Templates

Scaffolding

IDE tooling

---

# Success Criteria

A developer should be able to:

- install Lokio using npm or yarn
- choose any frontend framework (React, Next.js, Vue, Svelte, Solid, Vanilla JS, etc.)
- work with user-owned files through a unified API
- swap runtime adapters without changing application code
- extend functionality through plugins
- optionally enable native acceleration without modifying application logic

If these goals are achieved, Lokio will provide a clean, extensible foundation for building privacy-first, local-first applications without imposing a specific UI framework or data format.
