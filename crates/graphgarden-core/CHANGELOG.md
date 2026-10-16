# graphgarden-core

## 0.3.0 — 2026-10-16

### Minor changes

- [e00e15b](https://github.com/bruits/graphgarden/commit/e00e15b8477d75c524d80e52454599e6115c59cf) **⚠️ breaking change:** Changed `site.base_url` and `friends` to accept only site origins such as `https://alice.dev/`, without a path. — Thanks @goulvenclech!
- [e00e15b](https://github.com/bruits/graphgarden/commit/e00e15b8477d75c524d80e52454599e6115c59cf) Changed `graphgarden.json` to list nodes and edges in a stable order, with edges only toward pages of the graph or friends. Fixed missing and bogus edges, now that links resolve as in a browser and an `exclude_selectors` match on an `img` no longer hides the links after it. — Thanks @goulvenclech!
- [e00e15b](https://github.com/bruits/graphgarden/commit/e00e15b8477d75c524d80e52454599e6115c59cf) **⚠️ breaking change:** Changed `extract_page` to `Extractor::new(base_url, friends, exclude_selectors)?.extract_page(html, page_url)`, and the `ParseConfig` exclusion lists to `Vec<String>`. Changed several `Error` variants to named fields, with a new `InvalidSelector`, no more `FileWrite`, and a `ConfigParse` that wraps the `toml` 1.x error. — Thanks @goulvenclech!

## 0.2.0 — 2026-02-25

### Minor changes

- [c17eac8](https://github.com/bruits/graphgarden/commit/c17eac8e5f3d70467ab8c314f5818944a058e30c) Added `friends` field to the public file. `fetchFriendGraphs` now takes a `friends` parameter, and fetches all declared friends unconditionally. — Thanks @goulvenclech!

### Patch changes

- Updated dependencies: graphgarden-protocol (Cargo)@0.2.0

## 0.1.0 — 2026-02-20

### Minor changes

- [83bb10b](https://github.com/bruits/graphgarden/commit/83bb10b8b26433261ec2d08339cfd9cddb29e77d) Initial release of GraphGarden 🌱 — Thanks @goulvenclech!

### Patch changes

- Updated dependencies: graphgarden-protocol (Cargo)@0.1.0

