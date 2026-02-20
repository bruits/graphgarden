# GraphGarden Web Component

Drop-in `<graph-garden>` custom element that renders an interactive node graph from a site's [`graphgarden.json`](../../crates/graphgarden-protocol/README.md) file.

The component fetches the site's protocol file, merges friend graphs, computes a force-directed layout via ForceAtlas2, and renders an interactive visualisation with [Sigma.js](https://www.sigmajs.org/). Local nodes are shown in indigo, friend nodes in amber, with matching edge colours to distinguish internal links from cross-site friendships.

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

### Customization

#### Colors (CSS custom properties)

Override colors via CSS custom properties on the `<graph-garden>` element or any ancestor:

| Property                   | Default   | Description                        |
| -------------------------- | --------- | ---------------------------------- |
| `--gg-local-node-color`    | `#6366f1` | Color of nodes from the local site |
| `--gg-friend-node-color`   | `#f59e0b` | Color of nodes from friend sites   |
| `--gg-internal-edge-color` | `#94a3b8` | Color of edges between local pages |
| `--gg-friend-edge-color`   | `#fbbf24` | Color of edges to friend sites     |
| `--gg-label-color`         | `#334155` | Color of node labels               |

> Colors can be any format supported by Sigma.js: hex (`#rrggbb`, `#rgb`), `rgb()`, `rgba()`, or named CSS colors (e.g. `red`, `darkgreen`).

#### Layout and sizing (HTML attributes)

| Attribute    | Default | Description                             |
| ------------ | ------- | --------------------------------------- |
| `node-size`  | `4`     | Radius of graph nodes                   |
| `edge-size`  | `0.5`   | Thickness of graph edges                |
| `label-size` | `12`    | Font size of node labels                |
| `iterations` | `200`   | Number of ForceAtlas2 layout iterations |

```html
<graph-garden node-size="6" label-size="14" iterations="500"></graph-garden>
```

## Development

Refer to [CONTRIBUTING.md](../../CONTRIBUTING.md#graphgarden-web-component) for development setup and workflow details.
