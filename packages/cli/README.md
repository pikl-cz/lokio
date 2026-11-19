# @lokio/cli

Developer tooling for [Lokio](https://github.com/pikl-cz/lokio) workspaces.

```sh
npx @lokio/cli doctor
# or
npm install -D @lokio/cli
```

## Commands

```text
lokio init [dir] [--force]   Mark a folder as a Lokio workspace (.lokio/workspace.json)
lokio doctor [dir]           Check that this machine can run Lokio on the folder
lokio info [dir]             Show adapter capabilities and workspace statistics
lokio --help | --version
```

`[dir]` defaults to the current directory.

### `lokio doctor`

- Prints the Node version and platform.
- Checks that the folder is readable and writable, and whether recursive `fs.watch` works.
- Runs the full Lokio adapter conformance suite (the same checks as `@lokio/testing/conformance`) inside a temporary `.lokio/doctor-*` folder and removes it afterwards.
- Exits with code 1 if anything fails, so it works as a CI or support check. It is especially useful on network drives, synced folders (Dropbox, iCloud, OneDrive) and unusual filesystems.

### `lokio info`

Shows the CLI version, the adapter's capabilities and the number and total size of the workspace's files and folders. The `.lokio` metadata folder is skipped.
