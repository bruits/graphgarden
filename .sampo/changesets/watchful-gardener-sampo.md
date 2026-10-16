---
npm/graphgarden-web: minor
---

Changed `<graph-garden>` to draw a map, with local pages in green, a ring on each site's home, one node for a page linked with or without its trailing slash, and a hover that shows a page's full title, where it leads, its neighbours, and, on a friend's page, its whole site in orchid. Added a `ready` promise that resolves once the graph is rendered or loading has given up, made the layout about three times faster on large graphs, and left out a friend that does not answer within 10 seconds, which used to stall the graph.
