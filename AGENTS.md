# Agents Guide

GraphGarden is a protocol and toolkit to turn web rings into explorable link graphs, made in Rust.

## Useful Commands

```sh
cargo fmt --all                       # format
cargo clippy --all --all-targets      # lint
cargo test --all                      # test
```

## Useful Resources

- In [CONTRIBUTING.md](./CONTRIBUTING.md) : [Quality Guidelines](./CONTRIBUTING.md#quality-guidelines) applies to agents and humans equally, [Getting Started](./CONTRIBUTING.md#getting-started) helps you understand the project structure, and [Philosophy](./CONTRIBUTING.md#philosophy) is the project's north star.
- Per-crate READMEs (e.g. [graphgarden-core](./crates/graphgarden-core/README.md)) contain public API documentation, it should stay concise and user-facing.
- [PROTOCOL.md](./PROTOCOL.md) is the single source of truth for the technical specification of the GraphGarden protocol.
- [GitHub](https://github.com/bruits/graphgarden) Issues and PRs are the best place for implementation details, design discussions, and technical decisions.

## Agent Guardrails

- Do not create new documentation files to explain implementation.
- Do not alter CI/CD configuration unless explicitly instructed.
- Do not add external dependencies without justification. Prefer the standard library and existing utilities.
- Match the current project structure, naming, and style; do not create parallel patterns and avoid duplication.
- All code, comments, documentation, commit messages, and user-facing output must be in English.
