# GraphGarden

> If you look the right way, you can see that the whole world is a garden.

A [protocol](./crates/graphgarden-protocol/README.md), and related tools, to turn web rings into explorable node graphs 🪴

## Crates

GraphGarden is a monorepo that contains the following crates (Rust packages):

| Name                   | Description                                                           | Registry | README                                            |
| ---------------------- | --------------------------------------------------------------------- | -------- | ------------------------------------------------- |
| `graphgarden-protocol` | Protocol specification                                                | *WIP*    | [README](./crates/graphgarden-protocol/README.md) |
| `graphgarden`          | CLI — crawl a site and generate its protocol file                     | *WIP*    | [README](./crates/graphgarden/README.md)          |
| `graphgarden-core`     | Core library — protocol implementation, crawling, and link extraction | *WIP*    | [README](./crates/graphgarden-core/README.md)     |

## Fixtures

The `fixtures/` directory holds end-to-end test sites and a [Vitest](https://vitest.dev/) test suite that exercises the full build pipeline. See the [README](./fixtures/README.md) for details.

## Aknowledgments

GraphGarden is an open-source project born from [Bruits](https://bruits.org/), a Rust-focused collective.
