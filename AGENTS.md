# Agents Guide

GraphGarden is a Rust and TypeScript monorepo, with a new protocol and related tools to turn web rings into explorable node graphs 🪴

## Useful Commands

```sh
cargo fmt --all
cargo clippy --all --all-targets -- -D warnings    # lint Rust, exactly as CI does
cargo test --all
pnpm install                                       # install the TypeScript tools and fixtures, once
pnpm run fmt
pnpm run lint
pnpm run typecheck                                 # typecheck the web component and the e2e suite
pnpm run build                                     # build the web component
pnpm run test:web
pnpm run test:e2e                                  # build Alice, run the CLI on her, and check the whole pipeline
pnpm run capture                                   # build the website and retake the README screenshots
pnpm run check                                     # everything CI checks, in CI order
```

## Useful Resources

- In [CONTRIBUTING.md](./CONTRIBUTING.md): [Quality Guidelines](./CONTRIBUTING.md#quality-guidelines) applies to agents and humans equally, [Getting Started](./CONTRIBUTING.md#getting-started) helps you understand the project structure, and [Philosophy](./CONTRIBUTING.md#philosophy) is the project's north star.
- The [protocol specification](./crates/graphgarden-protocol/README.md) is the single source of truth for the GraphGarden protocol.
- Per-package READMEs (e.g. [graphgarden-core](./crates/graphgarden-core/README.md)) document the public API, and stay concise and user-facing.
- [GitHub](https://github.com/bruits/graphgarden) issues and PRs hold implementation details, design discussions, and technical decisions.

## Agent Guardrails

- `graphgarden.json` is a contract, see [Quality Guidelines](./CONTRIBUTING.md#quality-guidelines).
- Match the project's structure, naming, and style, with no parallel pattern or duplication. Add a dependency only with a reason, after the standard library and existing utilities.
- Add no documentation file to explain implementation, and change CI/CD only when asked.
- Code, comments, docs, commit messages, and user-facing output are in English.
- A change users meet ships with a Sampo changeset, see [CONTRIBUTING.md](./CONTRIBUTING.md#writing-changesets).
