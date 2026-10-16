---
npm/graphgarden-web: minor
---

**⚠️ breaking change:** Added `--gg-label-halo-color`, white by default, which colours label outlines, the hover fade, and the holes of home rings, so a page on another background must set it. Added `--gg-frontier-edge-color`, `--gg-highlight-node-color`, and `--gg-highlight-edge-color`, the last two for a hovered friend's site, all four with a required `GraphGardenConfig` field such as `labelHaloColor`, and made `GraphGardenConfig.iterations` optional, as the count now follows the graph's size.
