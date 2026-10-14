# garden.bruits.org

The site behind [garden.bruits.org](https://garden.bruits.org/), built with [Maudit](https://maudit.org/) and set in [Libron](https://github.com/nicoverbruggen/libron). Its front page draws the shared garden, and it also hosts the tutorial and the Join page.

## Participants

`graphgarden.toml` lists the site and its participants in the `graphgarden` CLI's format. Joining the garden is a pull request that adds an origin to `friends`, as the Join page explains.

## Build

From the repository root, build the component first, then the site:

```sh
pnpm install && pnpm run build
cd demo && cargo run --release
```

Maudit writes `dist/`, then `graphgarden-core` adds `dist/.well-known/graphgarden.json`. The component fetches `/.well-known/graphgarden.json`, so serve `dist/` from the root of an origin, for example with `python3 -m http.server --directory dist`.

The `Deploy website` workflow builds the site on pull requests and deploys it from `main` to Cloudflare with `wrangler.toml`.

## Capture mode

The front page reads the participants' files live. These query parameters make it reproducible:

| Parameter | Effect |
| --- | --- |
| `capture` | Reads the participants from the copies in `static/captures/` and shows the map alone, without the header or the legend, on a framed sheet over a transparent background. A participant without a copy shows only as an unlabelled grey node, from the Join page's link to it |
| `seed=N` | Seeds the layout, with `capture` (default 1) |
| `theme=light` or `theme=dark` | Forces a colour scheme |

`pnpm run capture`, from the repository root, builds the component and the site, then takes the README screenshots in both themes with headless Chrome and writes them to `.github/assets/` with `cwebp`. It needs Chrome and `cwebp` installed. Set `CHROME` to the browser binary when it is not at the macOS default (`google-chrome` elsewhere), and pass a seed to try another layout, e.g. `pnpm run capture 12`.

To add or refresh a copy, fetch the participant's file, e.g. `curl -o static/captures/erika.florist.json https://erika.florist/.well-known/graphgarden.json`. A new copy changes the layout, so compare a few seeds and set the one that shows the most labels as the default in `capture.mjs`.

## Font

Libron is the v0.31 web release, under the SIL Open Font License in `static/fonts/OFL.txt`.
