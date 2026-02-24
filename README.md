# GraphGarden

> If you look the right way, you can see that the whole world is a garden.

A [protocol](./crates/graphgarden-protocol/README.md), and related tools, to turn web rings into explorable node graphs 🪴

## Packages

GraphGarden is a monorepo that contains the following Rust crates and TypeScript packages:

| Name                   | Description                                                           | Registry                                                                                                                                                                  | README                                            |
| ---------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `graphgarden-protocol` | Protocol specification                                                | <a href="https://crates.io/crates/graphgarden-protocol"><img alt="GraphGarden Protocol Crates.io Version" src="https://img.shields.io/crates/v/graphgarden-protocol"></a> | [README](./crates/graphgarden-protocol/README.md) |
| `graphgarden-core`     | Core library — protocol implementation, crawling, and link extraction | <a href="https://crates.io/crates/graphgarden-core"><img alt="GraphGarden Core Crates.io Version" src="https://img.shields.io/crates/v/graphgarden-core"></a>             | [README](./crates/graphgarden-core/README.md)     |
| `graphgarden`          | CLI — crawl a site and generate its protocol file                     | <a href="https://crates.io/crates/graphgarden"><img alt="GraphGarden Crates.io Version" src="https://img.shields.io/crates/v/graphgarden"></a>                            | [README](./crates/graphgarden/README.md)          |
| `graphgarden-web`      | Web component — drop-in `<graph-garden>` custom element               | <a href="https://www.npmjs.com/package/graphgarden-web"><img alt="GraphGarden Web npm Version" src="https://img.shields.io/npm/v/graphgarden-web?color=blue"></a>         | [README](./packages/graphgarden-web/README.md)    |

## Fixtures

The `fixtures/` directory holds end-to-end test sites and a [Vitest](https://vitest.dev/) test suite that exercises the full build pipeline. See the [README](./fixtures/README.md) for details.

## Aknowledgments

GraphGarden is an open-source project born from [Bruits](https://bruits.org/), a Rust-focused collective.
