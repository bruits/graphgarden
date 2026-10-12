# GraphGarden CLI

CLI for [GraphGarden](https://github.com/bruits/graphgarden) — walk a built site and generate its [protocol](https://github.com/bruits/graphgarden/blob/main/crates/graphgarden-protocol/README.md) file.

## Usage

```sh
# Build from graphgarden.toml in the current directory
graphgarden build

# Use a custom config file
graphgarden build --config path/to/config.toml

# Print the version
graphgarden --version
```

It writes `<output.dir>/.well-known/graphgarden.json`. Rebuilding an unchanged site only changes `generated_at`.

## Configuration

`graphgarden.toml` — at the project root.

```toml
friends = [   # links to these origins become friend edges
  "https://bob.dev/",
  "https://carol.dev/",
]

[site]
base_url = "https://alice.dev/"   # site origin, without a path
title    = "Alice's Garden"
# description = "A blog about …"
# language    = "en"

[output]
dir = "./dist"    # default, relative to the current directory

[parse]
include = ["**/*.html"]            # default
exclude = ["admin/**"]             # files left out of the graph
exclude_selectors = ["header", "footer", "nav"]   # CSS selectors whose links are ignored
```

## Development

Refer to [CONTRIBUTING.md](../../CONTRIBUTING.md#getting-started) for development setup and workflow details.
