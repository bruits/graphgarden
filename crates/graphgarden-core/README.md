# graphgarden-core

Core library implementing the [GraphGarden protocol](https://github.com/bruits/graphgarden/blob/main/crates/graphgarden-protocol/README.md) — walks a built site's HTML output, extracts links, classifies them, and assembles the public `graphgarden.json` file.

See the [protocol specification](https://github.com/bruits/graphgarden/blob/main/crates/graphgarden-protocol/README.md) for full details.

## Modules

- **`config`** — `Config` mirrors `graphgarden.toml`, with `SiteConfig`, `OutputConfig` and `ParseConfig` for its tables. `Config::from_file(path)` and `FromStr` parse it, and `Config::validate()` checks every value before any file is read.
- **`model`** — Protocol data types: `Node`, `Edge`, `EdgeType`, `SiteMetadata`, `PublicFile`. `PublicFile` exposes `to_json()` / `from_json()` helpers. `PROTOCOL_VERSION` is re-exported at the crate root.
- **`extract`** — `Extractor::new(base_url, friends, exclude_selectors)` parses the site settings once, and `extract_page(html, page_url)` parses one HTML page via `lol_html` and returns `Result<(Node, Vec<Edge>)>`. Links to the site's host become `Internal` edges, links to a friend's host become `Friend` edges, and the rest is dropped.
- **`build`** — `build(config)` walks the output directory, extracts every HTML file matched by the include and exclude globs, and returns `Result<PublicFile>` with sorted nodes and edges. Internal edges to pages outside the graph are dropped. It does not call `validate()`.
- **`error`** — `Error` enum and `Result<T>` alias, both re-exported at the crate root.

## Quick example

```rust
use graphgarden_core::build::build;
use graphgarden_core::config::Config;

fn main() -> graphgarden_core::Result<()> {
    let config = Config::from_file("graphgarden.toml")?;
    config.validate()?;
    let public_file = build(&config)?;
    let json = public_file.to_json()?;
    println!("{json}");
    Ok(())
}
```

## Development

Refer to [CONTRIBUTING.md](../../CONTRIBUTING.md#graphgarden-core) for development setup and workflow details.
