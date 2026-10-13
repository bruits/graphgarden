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
| `capture` | Reads the participants from the copies in `static/captures/` and frames the page on a transparent background. A participant without a copy shows only as an unlabelled grey node, from the Join page's link to it |
| `seed=N` | Seeds the layout, with `capture` (default 1) |
| `theme=light` or `theme=dark` | Forces a colour scheme |

With `dist/` served on port 8000 as above, headless Chrome takes the README screenshots in both themes. Set `CHROME` to your browser binary.

```sh
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" # google-chrome or chromium on Linux
for theme in light dark; do
  "$CHROME" --headless=new --use-angle=swiftshader --enable-unsafe-swiftshader --hide-scrollbars \
    --default-background-color=00000000 --window-size=1200,800 --force-device-scale-factor=2 \
    --virtual-time-budget=8000 --screenshot="/tmp/graphgarden-$theme.png" \
    "http://localhost:8000/?capture&theme=$theme&seed=9"
done
cwebp -q 90 -alpha_q 100 /tmp/graphgarden-light.png -o ../.github/assets/screenshot.webp
cwebp -q 90 -alpha_q 100 /tmp/graphgarden-dark.png -o ../.github/assets/screenshot_dark.webp
```

To add or refresh a copy, fetch the participant's file, e.g. `curl -o static/captures/erika.florist.json https://erika.florist/.well-known/graphgarden.json`. A new copy changes the layout, so pick the seed again.

## Font

Libron is the v0.31 web release, under the SIL Open Font License in `static/fonts/OFL.txt`.
