# GraphGarden Web Component

Drop-in `<graph-garden>` custom element that renders an interactive node graph from a site's [`graphgarden.json`](../../crates/graphgarden-protocol/README.md) file.

The component fetches the site's protocol file, merges friend graphs, computes a force-directed layout via ForceAtlas2, and renders an interactive visualisation with [Sigma.js](https://www.sigmajs.org/). Local nodes are shown in indigo, friend nodes in amber, and frontier nodes (broken links or unreachable friends) in grey. Edge colours follow the same origin-based scheme. Nodes with more edges than the median node are drawn at 1.5 times `node-size`, and those above the ninth decile at twice, so their labels show from further out. Labels sit under their node in the element's `font-family`, and hovering a node fades all but its neighbours and shows where it leads. Node and edge URLs that are not http or https are ignored, and a friend site that does not answer within 10 seconds is left out.

## Usage

### Script tag (module)

```html
<script type="module" src="https://unpkg.com/graphgarden-web"></script>
<graph-garden style="width: 600px; height: 400px;"></graph-garden>
```

### Script tag (classic)

```html
<script src="https://unpkg.com/graphgarden-web/iife"></script>
<graph-garden style="width: 600px; height: 400px;"></graph-garden>
```

### npm

```sh
npm install graphgarden-web
```

```js
import "graphgarden-web";
```

```html
<graph-garden style="width: 600px; height: 400px;"></graph-garden>
```

### Waiting for the graph

`ready` is a promise that resolves once the element has rendered its graph, given up, or been removed. `graph` stays `null` when loading failed.

```js
await customElements.whenDefined("graph-garden");
await document.querySelector("graph-garden").ready;
```

### Customization

#### Colors (CSS custom properties)

Override colors via CSS custom properties on the `<graph-garden>` element or any ancestor:

| Property                   | Default   | Description                                                 |
| -------------------------- | --------- | ----------------------------------------------------------- |
| `--gg-local-node-color`    | `#6366f1` | Color of nodes from the local site                          |
| `--gg-friend-node-color`   | `#f59e0b` | Color of nodes from friend sites                            |
| `--gg-frontier-node-color` | `#9ca3af` | Color of frontier nodes (broken links, unreachable friends) |
| `--gg-local-edge-color`    | `#94a3b8` | Color of edges between local pages                          |
| `--gg-friend-edge-color`   | `#fbbf24` | Color of edges to friend sites                              |
| `--gg-label-color`         | `#334155` | Color of node labels                                        |
| `--gg-label-halo-color`    | `#ffffff` | Color of label outlines, usually the page background        |

> [!IMPORTANT]
> Colors can be any format supported by Sigma.js: hex (`#rrggbb`, `#rgb`), `rgb()`, `rgba()`, or named CSS colors (e.g. `red`, `darkgreen`).
>
> Set `--gg-label-halo-color` to the opaque page background, since labels are outlined with it and hovering fades the graph toward it. On a dark page, pair it with a light `--gg-label-color`, for example `--gg-label-halo-color: #0f172a` and `--gg-label-color: #e2e8f0`.

#### Layout and sizing (HTML attributes)

| Attribute    | Default                       | Description                             |
| ------------ | ----------------------------- | --------------------------------------- |
| `node-size`  | `4`                           | Base radius of graph nodes              |
| `edge-size`  | `0.5`                         | Thickness of graph edges                |
| `label-size` | `12`                          | Font size of node labels                |
| `iterations` | `200`, fewer above 1000 nodes | Number of ForceAtlas2 layout iterations |

Missing, non-numeric or non-positive values fall back to the default.

```html
<graph-garden node-size="6" label-size="14" iterations="500"></graph-garden>
```

## Development

Refer to [CONTRIBUTING.md](../../CONTRIBUTING.md#getting-started) for development setup and workflow details.
