# GraphGarden CLI

CLI for [GraphGarden](https://github.com/bruits/graphgarden) — crawl a site and generate its [protocol](https://github.com/bruits/graphgarden/blob/main/crates/graphgarden-protocol/README.md) file.

## Usage

```sh
# Build the graph from the default config (graphgarden.toml)
graphgarden build

# Use a custom config file
graphgarden build --config path/to/config.toml
```

## Configuration

`graphgarden.toml` — at the project root.

```toml
friends = [
  "https://bob.dev/",
  "https://carol.dev/",
]

[site]
base_url = "https://alice.dev/"
title    = "Alice's Garden"
# description = "A blog about …"
# language    = "en"

[output]
dir = "./dist"    # default

[parse]
include = ["**/*.html"]            # default
exclude = ["admin/**"]
exclude_selectors = ["header", "footer", "nav"]   # CSS selectors to skip when extracting links
```

## Development

Refer to [CONTRIBUTING.md](../../CONTRIBUTING.md#graphgarden-core) for development setup and workflow details.
