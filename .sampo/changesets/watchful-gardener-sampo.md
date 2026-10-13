---
npm/graphgarden-web: minor
---

Changed `<graph-garden>` to draw local pages in green, pages no fetched file describes in grey, each site's home as a ring and well-connected nodes larger, with labels under their node in the page's font, and to show where a hovered node leads, drawing a hovered friend page's site in orchid. Improved the layout of large graphs about threefold, left out friends that do not answer within 10 seconds, and added a `ready` promise that resolves once the graph is rendered.
