---
cargo/graphgarden-core: minor
cargo/graphgarden: minor
---

Changed `graphgarden.json` to list nodes and edges in a stable order and to keep only edges toward pages of the graph or friends. Links now resolve as in a browser, which fixes missing or bogus edges caused by letter case, unknown schemes, `http://` links to an `https://` site, and trailing slashes. An `exclude_selectors` match on a void element such as `img` no longer hides the links after it.
