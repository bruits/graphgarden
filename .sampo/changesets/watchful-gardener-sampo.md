---
npm/graphgarden-web: minor
---

Changed `<graph-garden>` to draw local pages in green, enlarge well-connected nodes so their labels show from further out, set labels under their node in the page's font, show where a hovered node leads, and leave out friends that do not answer within 10 seconds. Improved the layout of large graphs about threefold, and added a `ready` promise that resolves once the graph is rendered.
