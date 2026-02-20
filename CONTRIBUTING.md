# Contributing Guidelines

First, a huge **thank you** for dedicating your time to helping us improve GraphGarden ❤️

> [!Tip]
> **New to open source?** Check out [https://github.com/firstcontributions/first-contributions](https://github.com/firstcontributions/first-contributions) for helpful information on contributing

## Philosophy

GraphGarden aims to be a straightforward toolkit with a stable public API and reliable performance: crawl your site, build a link graph, and share it. The goal is to make it easy to create connections between personal sites, highlight projects from collectives, and contribute to a more open and interconnected web.

The protocol is open and decentralised — there is no invitation or acceptance mechanism. Adding someone as a friend pulls their graph into yours, but does not alter theirs. This means you can generate an isolated graph containing only your own site, or act as a bridge between many different communities.

We're also committed to fostering a welcoming and respectful community. Any issue, PR, or discussion that violates our [code of conduct](./CODE_OF_CONDUCT.md) will be deleted, and the authors will be **banned**.

## Before Opening Issues

- **Do not report security vulnerabilities publicly** (e.g., in issues or discussions), please refer to our [security policy](./SECURITY.md).
- **Do not create issues for questions about using GraphGarden.** Instead, ask your question in our [GitHub Discussions](https://github.com/bruits/graphgarden/discussions/categories/q-a).
- **Do not create issues for ideas or suggestions.** Instead, share your thoughts in our [GitHub Discussions](https://github.com/bruits/graphgarden/discussions/categories/ideas).
- **Check for duplicates.** Look through existing issues and discussions to see if your topic has already been addressed.
- In general, provide as much detail as possible. No worries if it's not perfect, we'll figure it out together.

## Before submitting Pull Requests (PRs)

- **Check for duplicates.** Look through existing PRs to see if your changes have already been submitted.
- **Check Clippy warnings.** Run `cargo clippy --all --all-targets` to ensure your code adheres to Rust's best practices.
- **Run formatting.** Run `cargo fmt --all` to ensure your code is properly formatted.
- **Write and run tests.** If you're adding new functionality or fixing a bug, please include tests to cover it. Run `cargo test --all` to ensure all existing tests pass.
- Prefer small, focused PRs that address a single issue or feature. Larger PRs can be harder to review, and can often be broken down into smaller, more manageable pieces.
- PRs don't need to be perfect. Submit your best effort, and we will gladly assist in polishing the work.

## Quality Guidelines

- Prefer self-documenting code first, with expressive names and straightforward logic. Comments should explain *why* (intent, invariants, trade-offs), not *how*. Variable and function names should be clear and descriptive, not cryptic abbreviations. Avoid hidden state and side effects.
- Tests should assert observable behavior (inputs/outputs, effects), not internal implementation details. Keep tests deterministic and independent of global state.
- For errors, use typed error enums in library crates (derived with `thiserror`), and `anyhow` in the binary crate (for CLI-level error propagation). Per-crate `pub type Result<T>` aliases for ergonomic signatures. Add context at the boundary (CLI) rather than deep in core, keep library error messages concise.
- Prefer `?` propagation when possible, and reserve `.expect()`/`.unwrap()` for cases where failure is a programmer bug (e.g. hardcoded regex literals, test helpers).
- Document any new public APIs, configuration options, or user-facing changes in the relevant README files. If you're unsure where or how to document something, just ask and we'll help you out.
- We deeply value idiomatic, easy-to-maintain Rust code. Avoid code duplication when possible. And prefer clarity over cleverness, and small focused functions over dark magic.
- Explicit `use` imports for standard library types (e.g. `use std::collections::HashMap;`).

## Writing Changesets

Each feature or bug fix that changes the public API or user-facing behavior should be accompanied by a [Sampo](https://github.com/bruits/sampo) changeset.

**Structure:**
1. **Breaking prefix (if applicable):** `**⚠️ breaking change:**`
2. **Verb:** `Added`, `Removed`, `Fixed`, `Changed`, `Deprecated`, or `Improved`.
3. **Description**.
4. **Usage example (optional):** A minimal snippet if it clarifies the change.

**Description guidelines:** concise (1-2 sentences), specific (mention the command/option/API), actionable (what changed, not why), user-facing (written for changelog readers), and in English. Don't detail internal implementation changes.

## Getting Started

GraphGarden is a polyglot monorepo. The Rust side uses [Cargo workspaces](https://doc.rust-lang.org/book/ch14-03-cargo-workspaces.html) (`crates/`), and the TypeScript side uses [pnpm workspaces](https://pnpm.io/workspaces) (`packages/`). Prerequisites: the latest stable [Rust](https://www.rust-lang.org/) toolchain, plus [Node.js](https://nodejs.org/) and [pnpm](https://pnpm.io/) for the web component and e2e tests.


### GraphGarden Protocol

`graphgarden-protocol` holds the [protocol specification](./crates/graphgarden-protocol/README.md) and versions it independently from the implementation crates. Its Rust library is intentionally minimal — it only exposes a `PROTOCOL_VERSION` constant. Changes to this crate should be rare and carefully considered, as they affect all implementations.

### GraphGarden Core

`graphgarden-core` is the core library that implements the [GraphGarden protocol](./crates/graphgarden-protocol/README.md). It owns the data model, walks a built site's HTML output, extracts links, classifies them, and assembles the public `graphgarden.json` file.

### GraphGarden CLI

`graphgarden` is the CLI built on top of `graphgarden-core`. It provides the user-facing commands to crawl a site and generate its protocol file.

### GraphGarden Web Component

`graphgarden-web` is the `<graph-garden>` custom element that renders an interactive node graph from a site's `graphgarden.json` file. It is bundled with [esbuild](https://esbuild.github.io/) into ESM and IIFE formats so sites can drop it in via `<script>` tag or `npm install`.

```sh
cd packages/graphgarden-web && pnpm install && pnpm run build
```

### E2E Fixtures

`fixtures/` contains end-to-end test sites and a [Vitest](https://vitest.dev/) test suite that exercises the full pipeline — Astro build, CLI run, and JSON validation. It includes two fixture sites: Alice (a minimal Astro site processed by the CLI) and Bob (a pre-written static `graphgarden.json` served via a mock HTTP server).

Running the e2e tests requires [Node.js](https://nodejs.org/) and [pnpm](https://pnpm.io/) in addition to Rust:

```sh
cd fixtures && pnpm install && pnpm test
```

---

Thank you once again for contributing, we deeply appreciate all contributions, no matter how small or big.
