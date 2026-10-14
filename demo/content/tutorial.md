# Tutorial

## How it works

Each site in a garden publishes one JSON file at `/.well-known/graphgarden.json`. It lists the site's pages as nodes, the links between them and to friend sites as edges, and the friends the site declares. The `<graph-garden>` element fetches the file of the site it sits on and the files of its friends, then draws them as one graph. The [specification](https://github.com/bruits/graphgarden/blob/main/crates/graphgarden-protocol/README.md) has the full format.

Friendship goes one way. Adding Bob shows his graph on your site, and Bob shows yours once he adds you back.

## Publish your graph

### From your own build

A site that already knows its pages can write the file itself. [goulven-clech.dev](https://goulven-clech.dev/) does this with an Astro endpoint that turns its posts and pages into nodes and the links in them into edges, in [`graphgarden.json.ts`](https://github.com/goulvenclech/goulven-clech.dev/blob/main/src/pages/.well-known/graphgarden.json.ts). A smaller version, for a blog whose home page lists its posts:

<!-- `js` because Maudit's highlighter has no TypeScript grammar -->

```js
// src/pages/.well-known/graphgarden.json.ts
import { getCollection } from "astro:content";

export const prerender = true;

const FRIENDS = ["https://bob.dev/"];

function friendLinks(markdown = ""): string[] {
  const urls = [...markdown.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map((match) => match[1]);
  return urls.filter((url) => FRIENDS.some((friend) => url.startsWith(friend)));
}

export async function GET() {
  const posts = await getCollection("blog");
  return Response.json({
    version: "0.2.0",
    generated_at: new Date().toISOString(),
    base_url: "https://alice.dev/",
    site: { title: "Alice's Garden" },
    friends: FRIENDS,
    nodes: [
      { url: "/", title: "Home" },
      ...posts.map((post) => ({ url: `/${post.id}/`, title: post.data.title })),
    ],
    edges: posts.flatMap((post) => [
      { source: "/", target: `/${post.id}/`, type: "internal" },
      ...friendLinks(post.body).map((target) => ({
        source: `/${post.id}/`,
        target,
        type: "friend",
      })),
    ]),
  });
}
```

Write each URL the way the site serves it, here with the trailing slash of Astro's default directory format, so links from friends land on the same node.

Friends fetch the file from their own pages, so it needs a CORS header. On Netlify or Cloudflare Pages, a `public/_headers` file sets it along with a moderate cache:

```
/.well-known/graphgarden.json
  Access-Control-Allow-Origin: *
  Cache-Control: public, max-age=3600
```

### With the CLI

The `graphgarden` CLI writes the file from any static site's built HTML. Install it with a [Rust](https://www.rust-lang.org/) toolchain, on your machine and wherever the site builds, since there is no prebuilt binary:

```sh
cargo install graphgarden
```

Describe the site in a `graphgarden.toml` at the project root, adding an `[output]` table with `dir` when the build does not land in `./dist`:

```toml
friends = ["https://bob.dev/"]

[site]
base_url = "https://alice.dev/"
title = "Alice's Garden"
```

Then chain it to the build, for example in `package.json` with `"build": "astro build && graphgarden build"`. It writes `dist/.well-known/graphgarden.json`, so a dev server that skips the build has no graph to show. The [CLI README](https://github.com/bruits/graphgarden/blob/main/crates/graphgarden/README.md) covers the other options, such as leaving out pages or the links of a site's navigation. The CORS header above applies here too.

## Show the graph

Drop the web component on any page of the site:

```html
<script type="module" src="https://unpkg.com/graphgarden-web"></script>
<graph-garden style="width: 100%; height: 600px"></graph-garden>
```

It reads the site's file, merges the friends' files, and lays the pages out. Clicking a node opens its page. CSS custom properties match it to the site, as goulven-clech.dev does on its [Friends](https://goulven-clech.dev/friends/) page:

```css
graph-garden {
  --gg-local-node-color: #da486c;
  --gg-friend-node-color: #2563eb;
}
```

The [web component README](https://github.com/bruits/graphgarden/blob/main/packages/graphgarden-web/README.md) lists every colour and attribute.

To appear on the shared garden of this site, see [Join](/join/).
