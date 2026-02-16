# Contributing Guidelines

First, a huge **thank you** for dedicating your time to helping us improve GraphGarden ❤️

> [!Tip]
> **New to open source?** Check out [https://github.com/firstcontributions/first-contributions](https://github.com/firstcontributions/first-contributions) for helpful information on contributing

## Philosophy

*TODO, add north star and values*

We're also committed to fostering a welcoming and respectful community. Any issue, PR, or discussion that violates our [code of conduct](https://github.com/bruits/graphgarden/blob/main/CODE_OF_CONDUCT.md) will be deleted, and the authors will be **banned**.

## Before Opening Issues

- **Do not report security vulnerabilities publicly** (e.g., in issues or discussions), please refer to our [security policy](https://github.com/bruits/graphgarden/blob/main/SECURITY.md).
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
- Prefer self-documenting code first, with expressive names and straightforward logic. Comments should explain *why* (intent, invariants, trade-offs), not *how*. Variable and function names should be clear and descriptive, not cryptic abbreviations.
- Document any new public APIs, configuration options, or user-facing changes in the relevant README files. If you're unsure where or how to document something, just ask and we'll help you out.
- We deeply value idiomatic, easy-to-maintain Rust code. Avoid code duplication when possible. And prefer clarity over cleverness, and small focused functions over dark magic.
- **PRs don't need to be perfect.** Submit your best effort, and we will gladly assist in polishing the work.

## Getting Started

GraphGarden is a fairly standard Rust project with a typical directory structure. The only prerequisite is to have the latest stable version of [Rust](https://www.rust-lang.org/) installed.

GraphGarden is a Rust monorepo using [Cargo workspaces](https://doc.rust-lang.org/book/ch14-03-cargo-workspaces.html). It contains multiple crates (Rust packages) in the `crates/` directory:

### GraphGarden Core

`graphgarden-core` is a plain Rust library that owns the crawling, graph construction, and data model. It is the heart of the project, containing the logic to fetch pages, extract links, and build the node graph.

### GraphGarden

`graphgarden` is the CLI facade on top of `graphgarden-core`. It wires commands together and provides the user-facing interface.

---

Thank you once again for contributing, we deeply appreciate all contributions, no matter how small or big.
