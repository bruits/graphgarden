# GraphGarden Protocol Specification

Each participating site publishes a `/.well-known/graphgarden.json` file describing its own page graph, with its web pages as nodes, and internal links + external links to friends as edges. Those files can be fetched (at runtime by web components, or at build time by static site generators) and stitched together into a single graph for exploration.

The protocol is open and decentralized: if Alice adds Bob as a friend, Alice's component displays Bob's graph, but Bob does not display Alice's unless he independently adds her too.

We provide a Rust implementation of the protocol, a CLI to generate the public file from a built site's HTML output, and a web component to display the graph on the site. But anyone can implement their own generator or visualizer as long as they adhere to the protocol specification below. The [tutorial](https://garden.bruits.org/tutorial/) shows how to write the file yourself or with the CLI, then display it.

## Public File

Served at `BASE_URL/.well-known/graphgarden.json`, where `BASE_URL` is the site origin.

```jsonc
{
  // Protocol version, for future compatibility and fallback handling
  "version": "0.2.0",
  // ISO 8601 timestamp of generation (UTC) used for caching
  "generated_at": "2026-02-17T12:00:00Z",
  // Site origin with a trailing slash and no path
  "base_url": "https://alice.dev/",
  "site": {
    "title": "Alice's Garden",        // required
    "description": "A blog about …",  // optional
    "language": "en"                   // optional, BCP 47
  },
  "friends": ["https://bob.dev/"],
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

- **`base_url`** — site origin with a trailing slash and no path, such as `https://alice.dev/`. A page under `https://x.dev/garden/` belongs to the `https://x.dev/` graph, since this file lives under `/.well-known/`.
- **`nodes[].url`** — relative path on the same site. Consumers **MUST** read a path with or without its trailing slash as the same page, so a link to `/about` lands on the node `/about/`.
- **`edges[].source`** — relative path (must match a node).
- **`edges[].target`** — relative path for `internal`, absolute URL for `friend`. Internal targets **SHOULD** match a node. Generators drop links to excluded, missing or non-HTML pages.
- **`edges[].type`** — `"internal"` (same site) or `"friend"` (site declared in config). Other external links are ignored when the file is generated.
- **`friends`** — array of declared friend site origins, in the same form as `base_url`. All listed origins are fetched unconditionally by the web component, regardless of whether any edges reference them. Files from protocol 0.1.0 omit this field, which consumers **MUST** read as an empty array.

## Caching

- Servers **SHOULD** include an `ETag` header (most static hosts do this automatically).
- Servers **SHOULD** set `Cache-Control: public, max-age=3600` (or a similar moderate TTL) so the web component avoids redundant fetches within a session while ensuring freshness on subsequent visits.
- Servers **MUST** set `Access-Control-Allow-Origin: *` so the web component can fetch friends' files cross-origin.
