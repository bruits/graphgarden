# graphgarden-web

## 0.4.0 — 2026-10-16

### Minor changes

- [63d6cfc](https://github.com/bruits/graphgarden/commit/63d6cfc18913afe0490dc87be7f61d48754e0c0d) Added a `restyle()` method to `<graph-garden>` that rereads its color custom properties and repaints the graph without reloading or moving it. The element also repaints itself when the color scheme preference changes. — Thanks @goulvenclech!

## 0.3.0 — 2026-10-16

### Minor changes

- [4416380](https://github.com/bruits/graphgarden/commit/4416380d84e1e8feea3bcb79d1201a7ed37fd0ed) Changed `<graph-garden>` to draw a map, with local pages in green, a ring on each site's home, one node for a page linked with or without its trailing slash, and a hover that shows a page's full title, where it leads, its neighbours, and, on a friend's page, its whole site in orchid. Added a `ready` promise that resolves once the graph is rendered or loading has given up, made the layout about three times faster on large graphs, and left out a friend that does not answer within 10 seconds, which used to stall the graph. — Thanks @goulvenclech!
- [4416380](https://github.com/bruits/graphgarden/commit/4416380d84e1e8feea3bcb79d1201a7ed37fd0ed) **⚠️ breaking change:** Added `--gg-label-halo-color`, white by default, which colours label outlines, the hover fade, and the holes of home rings, so a page on another background must set it. Added `--gg-frontier-edge-color`, `--gg-highlight-node-color`, and `--gg-highlight-edge-color`, the last two for a hovered friend's site, all four with a required `GraphGardenConfig` field such as `labelHaloColor`, and made `GraphGardenConfig.iterations` optional, as the count now follows the graph's size. — Thanks @goulvenclech!

## 0.2.0 — 2026-02-25

### Minor changes

- [c17eac8](https://github.com/bruits/graphgarden/commit/c17eac8e5f3d70467ab8c314f5818944a058e30c) Added `friends` field to the public file. `fetchFriendGraphs` now takes a `friends` parameter, and fetches all declared friends unconditionally. — Thanks @goulvenclech!
- [c33792d](https://github.com/bruits/graphgarden/commit/c33792d0af65adb82c533f38d0a59a629ce14861) Added frontier node color for broken links and unreachable friends, customisable via `--gg-frontier-node-color` CSS property. — Thanks @goulvenclech!
- [6cddbe3](https://github.com/bruits/graphgarden/commit/6cddbe37181d18ceed2b0d99f2adce884d3d4f16) **⚠️ breaking change:** Changed edge and node colors to reflect site origin instead of edge type. The `internalEdgeColor` config field is renamed to `localEdgeColor`, and the CSS custom property `--gg-internal-edge-color` is renamed to `--gg-local-edge-color`. — Thanks @goulvenclech!

### Patch changes

- [82ac2cd](https://github.com/bruits/graphgarden/commit/82ac2cd3399456863f646d7b57355de29bb7ae04) Fixed `edge-size` attribute having no effect on the `<graph-garden>` web component. — Thanks @goulvenclech!

## 0.1.0 — 2026-02-20

### Minor changes

- [83bb10b](https://github.com/bruits/graphgarden/commit/83bb10b8b26433261ec2d08339cfd9cddb29e77d) Initial release of GraphGarden 🌱 — Thanks @goulvenclech!

