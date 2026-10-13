// Takes the README screenshots from `dist/`, which `pnpm run capture` rebuilds first.
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";

// `parseArgs` drops the `--` that pnpm forwards from `pnpm run capture -- 12`
const { positionals } = parseArgs({ allowPositionals: true });
// The layout with the fewest label overlaps for the current copies in `static/captures/`
const SEED = positionals[0] ?? "9";
if (!/^\d+$/.test(SEED)) {
    console.error(`The seed must be a whole number, not "${SEED}".`);
    process.exit(1);
}
const CHROME =
    process.env.CHROME ??
    (process.platform === "darwin"
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : "google-chrome");
const DIST = fileURLToPath(new URL("dist/", import.meta.url));
const ASSETS = fileURLToPath(new URL("../.github/assets/", import.meta.url));
const TYPES = {
    ".css": "text/css",
    ".html": "text/html",
    ".js": "text/javascript",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
};

// Asynchronous, so the server keeps answering while Chrome loads the page
const run = promisify(execFile);

const server = createServer(async (request, response) => {
    const path = normalize(decodeURIComponent(new URL(request.url, "http://localhost").pathname));
    const file = join(DIST, path.endsWith("/") ? `${path}index.html` : path);
    try {
        const body = await readFile(file);
        response.writeHead(200, {
            "content-type": TYPES[extname(file)] ?? "application/octet-stream",
        });
        response.end(body);
    } catch {
        response.writeHead(404).end();
    }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const shots = await mkdtemp(join(tmpdir(), "graphgarden-"));

try {
    for (const [theme, name] of [
        ["light", "screenshot"],
        ["dark", "screenshot_dark"],
    ]) {
        const png = join(shots, `${theme}.png`);
        await run(CHROME, [
            "--headless=new",
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
            "--hide-scrollbars",
            "--default-background-color=00000000",
            "--window-size=1200,800",
            "--force-device-scale-factor=2",
            "--virtual-time-budget=8000",
            `--screenshot=${png}`,
            `${origin}/?capture&theme=${theme}&seed=${SEED}`,
        ]);
        await run("cwebp", [
            "-quiet",
            "-q",
            "90",
            "-alpha_q",
            "100",
            png,
            "-o",
            join(ASSETS, `${name}.webp`),
        ]);
        console.log(`${name}.webp, seed ${SEED}`);
    }
} finally {
    server.close();
    await rm(shots, { recursive: true, force: true });
}
