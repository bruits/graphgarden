# GraphGarden Web Component

Drop-in `<graph-garden>` custom element that renders an interactive node graph from a site's [`graphgarden.json`](../../crates/graphgarden-protocol/README.md) file.

## Usage

### Script tag (module)

```html
<script type="module" src="https://unpkg.com/graphgarden-web"></script>
<graph-garden></graph-garden>
```

### Script tag (classic)

```html
<script src="https://unpkg.com/graphgarden-web/iife"></script>
<graph-garden></graph-garden>
```

### npm

```sh
npm install graphgarden-web
```

```js
import "graphgarden"
```

```html
<graph-garden></graph-garden>
```

## Development

```sh
pnpm install
pnpm run build   # bundle ESM + IIFE and emit type declarations
pnpm run dev      # rebuild on change
```

## Build outputs

| File                       | Format | Use case                            |
| -------------------------- | ------ | ----------------------------------- |
| `dist/graphgarden.js`      | ESM    | `import` / `<script type="module">` |
| `dist/graphgarden.iife.js` | IIFE   | Classic `<script>` tag              |
| `dist/index.d.ts`          | —      | TypeScript type declarations        |
