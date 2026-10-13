---
npm/graphgarden-web: minor
---

Changed `<graph-garden>` to ignore non-HTTP(S) URLs and friends' claims on local pages, leave out friends that do not answer within 10 seconds, stop loading when removed, lay out graphs of a few thousand nodes about three times faster, draw better-connected nodes larger so their labels show from further out, write labels under their node in the page's font, show where a hovered node leads, and draw local pages and their links in green. Added a `ready` promise that resolves once the graph is rendered.
