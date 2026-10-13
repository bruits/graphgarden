---
npm/graphgarden-web: minor
---

**⚠️ breaking change:** Changed `GraphGardenConfig.iterations` to optional and removed it from `DEFAULT_CONFIG`. When unset, the iteration count decreases as the graph grows. Changed `<graph-garden>` to outline labels with the new `--gg-label-halo-color` CSS property and required `GraphGardenConfig.labelHaloColor` field, and fade all but a hovered node and its neighbours toward that color. The property defaults to white, so a page with another background must set it.
