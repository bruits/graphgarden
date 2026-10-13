---
cargo/graphgarden-core: minor
cargo/graphgarden: minor
---

Changed `graphgarden.json` to list nodes and edges in a stable order, with edges only toward pages of the graph or friends. Fixed missing or bogus edges, as links now resolve as in a browser and an `exclude_selectors` match on an `img` no longer hides the links after it.
