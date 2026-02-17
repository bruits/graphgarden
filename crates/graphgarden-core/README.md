# graphgarden-core

Core library for [GraphGarden]([../../README.md](https://github.com/bruits/graphgarden)), to crawl websites and build a node graph of pages and links.

See [PROTOCOL.md]([../../PROTOCOL.md](https://github.com/bruits/graphgarden/blob/main/PROTOCOL.md)) for the full specification.

## Configuration parsing

`Config` reads and deserialises a site's configuration file. It also implements `FromStr` for parsing from a raw string.

```rust
use graphgarden_core::config::Config;

let config = Config::from_file("graphgarden.toml")?;
println!("{}", config.site.base_url);
```

Main types:

| Struct         | Key fields                                                            |
| -------------- | --------------------------------------------------------------------- |
| `Config`       | `site`, `friends`, `output`, `parse`                                  |
| `SiteConfig`   | `base_url`, `title`, `description?`, `language?`                      |
| `OutputConfig` | `dir` (default `"./dist"`)                                            |
| `ParseConfig`  | `include` (default `["**/*.html"]`), `exclude?`, `exclude_selectors?` |

## Protocol data structures

`Model` defines the core data structures for the public and compiled files, as well as the in-memory graph representation.

```rust
use graphgarden_core::model::{PublicFile, Node, Edge, EdgeType, SiteMetadata};

let public = PublicFile {
    version: String::from("1.0.0"),
    generated_at: String::from("2026-02-17T12:00:00Z"),
    base_url: String::from("https://example.dev/"),
    site: SiteMetadata {
        title: String::from("My Site"),
        description: None,
        language: Some(String::from("en")),
    },
    nodes: vec![Node { url: String::from("/"), title: String::from("Home") }],
    edges: vec![Edge {
        source: String::from("/"),
        target: String::from("/about"),
        edge_type: EdgeType::Internal,
    }],
};

let json = public.to_json()?;
let parsed = PublicFile::from_json(&json)?;
```

Key types: `Node`, `Edge`, `EdgeType` (`Internal` | `Friend`), `SiteMetadata`, `PublicFile`, `CompiledFile`, `SiteGraph`.

Both `PublicFile` and `CompiledFile` expose `to_json()` / `from_json()` helpers.

## Errors

- `Error` — `ConfigNotFound`, `ConfigRead`, `ConfigParse`, `JsonSerialize`, `JsonDeserialize`
- `Result<T>` — type alias for `std::result::Result<T, Error>`
