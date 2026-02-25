# graphgarden-web

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

