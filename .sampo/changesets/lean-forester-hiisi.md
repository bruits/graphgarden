---
npm/graphgarden-web: minor
---

**⚠️ breaking change:** Added the required `GraphGardenConfig.labelHaloColor` field and `--gg-label-halo-color` CSS property, white by default, which outlines labels and colours the hover fade, so a page on another background must set it. Changed `GraphGardenConfig.iterations` to optional and removed it from `DEFAULT_CONFIG`, as the count now follows the graph's size.
