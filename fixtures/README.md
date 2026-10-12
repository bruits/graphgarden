# graphgarden-fixtures

End-to-end test fixtures and integration test suite for the [GraphGarden](https://github.com/bruits/graphgarden) build pipeline.

## Fixture Sites

- **Alice** — a minimal [Astro](https://astro.build/) site about European rabbit species (4 pages) with a `graphgarden.toml` config. The CLI processes her built HTML to generate `graphgarden.json`.
- **Bob** — a pre-written static `graphgarden.json` mock ("Bob's Your Uncle" — English rabbit regions). Served via a Node.js HTTP mock server in tests to simulate an already-published friend site.

## Tests

The test suite (`tests/pipeline.test.ts`) uses [Vitest](https://vitest.dev/) to build the web component, Alice's Astro site and the CLI, then runs the CLI on Alice. It checks what only the whole pipeline shows. Alice's Astro pages become the expected graph, her file passes the web component's validator, friend edges resolve between Alice and Bob, and `<graph-garden>` renders both. The suite imports `graphgarden-web` from its TypeScript sources, while Alice's Astro build bundles the built package.

Prerequisites: [Node.js](https://nodejs.org/), [pnpm](https://pnpm.io/), and [Rust](https://www.rust-lang.org/).

```sh
pnpm install && pnpm test
```

## Development

Refer to [CONTRIBUTING.md](../CONTRIBUTING.md#getting-started) for development setup and workflow details.
