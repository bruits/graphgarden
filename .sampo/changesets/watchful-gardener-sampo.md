---
npm/graphgarden-web: minor
---

Changed `<graph-garden>` to draw local pages in green, pages no fetched file describes in grey, each site's home as a ring and well-connected nodes larger, with short labels under their node in the page's font that never overlap, and to show a hovered node's full title and where it leads, drawing a hovered friend page's site in orchid. Improved the layout, about three times faster on large graphs and more spacious, limited zooming out, left out friends that do not answer within 10 seconds, and added a `ready` promise that resolves once the graph is rendered.
