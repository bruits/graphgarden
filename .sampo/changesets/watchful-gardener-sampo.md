---
npm/graphgarden-web: minor
---

Changed `<graph-garden>` to ignore non-HTTP(S) URLs and friends' claims on local pages, leave out friends that do not answer within 10 seconds, stop loading when removed, and lay out graphs of a few thousand nodes about three times faster. Added a `ready` promise that resolves once the graph is rendered.
