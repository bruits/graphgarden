import { build } from "esbuild"

/** Shared options for all bundles */
const shared = {
  entryPoints: ["src/index.ts"],
  bundle: true,
  minify: true,
  sourcemap: true,
  target: "es2023",
} as const

await Promise.all([
  // ESM — for `import` / `<script type="module">`
  build({
    ...shared,
    format: "esm",
    outfile: "dist/graphgarden.js",
  }),
  // IIFE — for classic `<script>` tag (self-registers the element)
  build({
    ...shared,
    format: "iife",
    outfile: "dist/graphgarden.iife.js",
  }),
])
