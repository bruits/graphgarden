# GraphGarden Protocol Specification

Each participating site publishes a public JSON file describing its own page graph (nodes = pages, edges = links). Any site can fetch friends' public files and compile them into a merged graph for display. There is no accept/reject mechanism, the protocol is open and decentralized : if Alice adds Bob as a friend, Alice displays Bob's graph, but Bob does not display Alice's unless he independently adds her too.

## Public File

`graphgarden.json` — served at the site root.

```jsonc
{
  // Semver major bump = breaking change
  "version": "1.0.0",
  // ISO 8601 timestamp of generation (UTC) used for caching
  "generated_at": "2026-02-17T12:00:00Z",
  // Canonical site URL (with trailing slash)
  "base_url": "https://alice.dev/",
  "site": {
    "title": "Alice's Garden",        // required
    "description": "A blog about …",  // optional
    "language": "en"                   // optional, BCP 47
  },
  "nodes": [
    { "url": "/", "title": "Home" },
    { "url": "/about", "title": "About" },
    { "url": "/posts/hello", "title": "Hello World" }
  ],
  "edges": [
    { "source": "/", "target": "/about", "type": "internal" },
    { "source": "/", "target": "/posts/hello", "type": "internal" },
    { "source": "/about", "target": "https://bob.dev/", "type": "friend" }
  ]
}
```

- **`nodes[].url`** — relative path on the same site.
- **`edges[].source`** — relative path (must match a node).
- **`edges[].target`** — relative path for `internal`, absolute URL for `friend`.
- **`edges[].type`** — `"internal"` (same site) or `"friend"` (site declared in config). Other external links are ignored during crawl.

## Compiled File

`graphgarden.compiled.json` — also served at the site root. Built by fetching friends' public files and juxtaposing them (not flattening), so the web component can distinguish own vs. friend nodes.

```jsonc
{
  "version": "1.0.0",
  "compiled_at": "2026-02-17T12:05:00Z",
  "self": {
    "base_url": "https://alice.dev/",
    "site": { "title": "Alice's Garden" },
    "nodes": [ /* … */ ],
    "edges": [ /* … */ ]
  },
  "friends": [
    {
      "base_url": "https://bob.dev/",
      "site": { "title": "Bob's Garden" },
      "nodes": [ /* … */ ],
      "edges": [ /* … */ ]
    }
  ]
}
```

- **`self`** and each entry in **`friends`** share the same shape: `{ base_url, site, nodes, edges }` (the public file's content minus `version` and `generated_at`).
- The `friend`-type edges in `self.edges` act as bridges between `self` and `friends` graphs.
- Edges between friends are preserved: if Alice links to Bob and both are in your friend list, the component can render that cross-friend bridge.

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

## Workflow

1. Add a `graphgarden.toml` to your project root.
2. Build your site (Hugo, Zola, Astro, plain HTML, etc.).
3. Run `graphgarden build` — crawls the built site, produces `graphgarden.json`.
4. Run `graphgarden compile` (or `graphgarden build --compile`) — fetches friends' public files, produces `graphgarden.compiled.json`.
5. Deploy both JSON files alongside your site.
6. Add the `<graph-garden>` web component to your pages to render the graph.
