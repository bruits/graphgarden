# graphgarden-core

Core library for [GraphGarden](https://github.com/bruits/graphgarden) — walks a built site's HTML output, extracts links, classifies them, and assembles the public graph file.

See the [protocol specification](https://github.com/bruits/graphgarden/blob/main/PROTOCOL.md) for full details.

## Modules

- **`config`** — `Config::from_file(path)` loads a `graphgarden.toml` configuration file. Also implements `FromStr` for parsing from a raw string.
- **`model`** — Protocol data types: `Node`, `Edge`, `EdgeType`, `SiteMetadata`, `PublicFile`, `CompiledFile`, `SiteGraph`. Both `PublicFile` and `CompiledFile` expose `to_json()` / `from_json()` helpers.
- **`extract`** — `extract_page(html, page_url, base_url, friends, exclude_selectors)` parses an HTML page (via `lol_html`), extracts the title and links, and classifies edges as `Internal` or `Friend` (external links are dropped). Returns `Result<(Node, Vec<Edge>)>`.
- **`fetch`** — `fetch_friend(base_url, cache)` fetches a friend's `graphgarden.json` over HTTP (via `reqwest`), with timestamp-based caching using `FetchCache`. Returns `FetchOutcome::Fresh(PublicFile)` when the remote file is new or updated, or `FetchOutcome::Cached` when unchanged.
- **`build`** — `build(config)` walks the output directory, applies include/exclude globs, extracts links from every matched HTML file, and returns a complete `Result<PublicFile>`.
- **`error`** — `Error` enum and `Result<T>` alias, both re-exported at the crate root.

## Quick example

```rust
use graphgarden_core::config::Config;
use graphgarden_core::build::build;

let config = Config::from_file("graphgarden.toml")?;
let public_file = build(&config)?;
let json = public_file.to_json()?;
```

## Development

Refer to [CONTRIBUTING.md](../../CONTRIBUTING.md#graphgarden-core) for development setup and workflow details.
