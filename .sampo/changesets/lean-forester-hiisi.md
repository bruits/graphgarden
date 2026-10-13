---
npm/graphgarden-web: minor
---

**⚠️ breaking change:** Added the required `GraphGardenConfig` fields `labelHaloColor`, `frontierEdgeColor`, `highlightNodeColor` and `highlightEdgeColor`, each with a `--gg-*` CSS property, where `labelHaloColor` is white by default and colours label outlines, the hover fade and the hole of home rings, so a page on another background must set it. Changed `GraphGardenConfig.iterations` to optional and removed it from `DEFAULT_CONFIG`, as the count now follows the graph's size.
