# Security policy

## Supported versions

Lokio is pre-1.0. Security fixes land in the latest released minor version.

## Reporting a vulnerability

Please **do not open a public issue**. Report privately via
[GitHub Security Advisories](https://github.com/pikl-cz/lokio/security/advisories/new).
You'll get an acknowledgement within a few days; we'll agree on a disclosure timeline with you.

Especially relevant areas:

- path handling that lets a workspace path escape its root (`@lokio/core` `normalizePath`, `@lokio/node`)
- the encryption plugin (`@lokio/plugin-encryption`) - format, key derivation, misuse of Web Crypto
- lock files and temp files written by `@lokio/node`
