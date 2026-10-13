# Contributing Guidelines

## Philosophy

GraphGarden turns web rings into explorable node graphs. A site's build is walked into a small public file, `graphgarden.json`, and a web component draws it together with the graphs of the sites it calls friends. The toolkit stays straightforward, with a stable public API and reliable performance, so personal sites and collectives can link up into a more open web.

The protocol is open and decentralised, with no invitation or acceptance step. Adding someone as a friend pulls their graph into yours and leaves theirs untouched. A site can keep an isolated graph of its own pages, or bridge many communities.

Issues, PRs, and discussions that break the [code of conduct](./CODE_OF_CONDUCT.md) are deleted and their authors banned.

## Before Opening Issues

- Report a security vulnerability privately, as the [security policy](./SECURITY.md) explains.
- Ask questions about using GraphGarden on [Discord](https://discord.com/invite/84pd4QtmzA), and open a [feature request](https://github.com/bruits/graphgarden/issues/new?template=02-feature-request.yml) for an idea.

## Quality Guidelines

- Write self-documenting, idiomatic code, with clear names, plain logic, small functions, and no hidden state or side effects. Avoid duplication. Comments say why (intent, invariants, trade-offs), and never decorate or separate. The formatters and linters in [AGENTS.md](./AGENTS.md) settle style.
- In Rust, import standard library types explicitly (e.g. `use std::collections::HashSet;`), propagate errors with `?`, and keep `.expect()` and `.unwrap()` for programmer bugs. Library crates have a `thiserror` error enum and a `pub type Result<T>` alias, with concise messages in the core and context added by the CLI through `anyhow`.
- In TypeScript, stay `strict`-clean with no `any`. Never cast a null check away with `as`, and keep `!` for a programmer bug. Every promise is awaited, returned, or marked `void` with its failure reported. Mark type-only imports with `type`.
- `graphgarden.json` is a contract. The same site writes the same file apart from `generated_at`, and a change to its shape starts in the [protocol specification](./crates/graphgarden-protocol/README.md).
- Tests assert observable behaviour, stay deterministic, and share no global state. Rust unit tests sit in their module and the CLI's in `crates/graphgarden/tests/`. Web tests sit beside their module and run with Vitest in happy-dom, faking only what surrounds the unit (e.g. `fetch`, timers, Sigma). New behaviour ships with tests, and touched behaviour gains them.
- Public APIs, configuration options, and user-facing behaviour are documented in the relevant README.

## Writing Changesets

[Sampo](https://github.com/bruits/sampo) versions the packages and writes their changelogs from changesets. A change that users of a package meet ships with one. Install Sampo with `cargo install sampo`, then run `sampo add -p cargo/graphgarden-core cargo/graphgarden -b minor -m "Added …"`. Packages are named with their registry, since `graphgarden` exists on both crates.io and npm.

While GraphGarden is 0.x, a feature or a breaking change is a `minor` bump, and a fix a `patch`.

Write one changeset per set of packages and breaking flag, merging related changes, since every listed package's changelog shows the whole text. Internal refactors, tests, and docs need none. The version of `graphgarden-protocol` is the protocol version written into every `graphgarden.json`, so it only moves when the file format does.

A description starts with `Added`, `Removed`, `Fixed`, `Changed`, `Deprecated`, or `Improved`, and says in one or two sentences what changed for users, without the implementation. A breaking change opens with `**⚠️ breaking change:**`.

## Getting Started

GraphGarden is a polyglot monorepo, with a [Cargo workspace](https://doc.rust-lang.org/book/ch14-03-cargo-workspaces.html) for the Rust crates and a [pnpm workspace](https://pnpm.io/workspaces) for the TypeScript packages and the e2e fixtures. It needs the stable [Rust](https://www.rust-lang.org/) toolchain, [Node.js](https://nodejs.org/) LTS, and [pnpm](https://pnpm.io/) at the version `package.json` pins. Run `pnpm install` once at the root, then the commands in [AGENTS.md](./AGENTS.md). `pnpm run check` runs everything CI checks, in CI order.

| Path | What it holds |
| --- | --- |
| `crates/graphgarden-protocol` | The protocol [specification](./crates/graphgarden-protocol/README.md), versioned on its own, and the `PROTOCOL_VERSION` constant |
| `crates/graphgarden-core` | The data model, link extraction, and the walk that builds `graphgarden.json` |
| `crates/graphgarden` | The CLI, on top of `graphgarden-core` |
| `packages/graphgarden-web` | The `<graph-garden>` custom element, bundled with esbuild into ESM and IIFE |
| `packages/graphgarden` | A placeholder that reserves the name on npm |
| `fixtures/` | The e2e suite, with Alice, an Astro site the CLI walks, and Bob, a static file served by a mock server |
| `demo/` | The [Maudit](https://maudit.org/) site behind [garden.bruits.org](https://garden.bruits.org/), with the shared garden, the tutorial, and the README screenshots, in its own Cargo workspace and deployed by its own workflow |
