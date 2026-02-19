# graphgarden-fixtures

End-to-end test fixtures and integration test suite for the [GraphGarden](https://github.com/bruits/graphgarden) build pipeline.

## Fixture Sites

- **Alice** — a minimal [Astro](https://astro.build/) site about European rabbit species (4 pages) with a `graphgarden.toml` config. The CLI processes her built HTML to generate `graphgarden.json`.
- **Bob** — a pre-written static `graphgarden.json` mock ("Bob's Your Uncle" — English rabbit regions). Served via a Node.js HTTP mock server in tests to simulate an already-published friend site.

## Tests

The test suite (`tests/pipeline.test.ts`) uses [Vitest](https://vitest.dev/) to run the full pipeline: install dependencies, build the Astro site, compile and run the CLI, then validate the generated JSON against the [protocol specification](https://github.com/bruits/graphgarden/blob/main/crates/graphgarden-protocol/README.md). It also spins up a mock server for Bob and verifies cross-site friend edges.

Prerequisites: [Node.js](https://nodejs.org/), [pnpm](https://pnpm.io/), and [Rust](https://www.rust-lang.org/).

```sh
pnpm install && pnpm test
```

## Development

Refer to [CONTRIBUTING.md](../CONTRIBUTING.md#e2e-fixtures) for development setup and workflow details.
