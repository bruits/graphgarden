import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { describe, test, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import {
	isGraphGardenFile,
	buildGraph,
	fetchFriendGraphs,
	type GraphGarden,
	DEFAULT_CONFIG,
	type GraphGardenFile,
} from "graphgarden-web";

const ROOT = resolve(import.meta.dirname, "..");
const ALICE_DIR = resolve(ROOT, "alice");
const ALICE_DIST = resolve(ALICE_DIR, "dist");
const CARGO_ROOT = resolve(ROOT, "..");
const TARGET_DIR = resolve(CARGO_ROOT, process.env.CARGO_TARGET_DIR ?? "target");
const BOB_JSON = readFileSync(resolve(ROOT, "bob", "graphgarden.json"), "utf-8");
const bob: GraphGardenFile = JSON.parse(BOB_JSON);

let aliceJson: string;
let alice: GraphGardenFile;

beforeAll(() => {
	rmSync(ALICE_DIST, { recursive: true, force: true });
	execFileSync("pnpm", ["run", "build"], { cwd: resolve(ROOT, "../packages/graphgarden-web") });
	execFileSync("pnpm", ["run", "build"], { cwd: ALICE_DIR });
	execFileSync("cargo", ["build"], { cwd: CARGO_ROOT });
	execFileSync(resolve(TARGET_DIR, "debug", "graphgarden"), ["build"], { cwd: ALICE_DIR });

	aliceJson = readFileSync(resolve(ALICE_DIST, ".well-known", "graphgarden.json"), "utf-8");
	alice = JSON.parse(aliceJson);
});

function pagesOf(file: GraphGardenFile): string[] {
	return file.nodes.map((node) => new URL(node.url, file.base_url).href);
}

function friendTargetsOf(file: GraphGardenFile): string[] {
	return file.edges.filter((edge) => edge.type === "friend").map((edge) => edge.target);
}

describe("Alice, built by the CLI", () => {
	test("matches the protocol version and passes the web validator", () => {
		const cargoToml = resolve(CARGO_ROOT, "crates", "graphgarden-protocol", "Cargo.toml");
		const protocolVersion = readFileSync(cargoToml, "utf-8").match(/^version = "(.+)"$/m)?.[1];

		expect(alice.version).toBe(protocolVersion);
		expect(isGraphGardenFile(alice)).toBe(true);
	});

	test("turns her Astro pages into the expected graph", () => {
		expect(alice.nodes.map((node) => node.url)).toEqual([
			"/",
			"/about/",
			"/species/european-rabbit/",
			"/species/mountain-hare/",
		]);
		expect(alice.edges.map((edge) => `${edge.source} -> ${edge.target} (${edge.type})`)).toEqual([
			"/ -> /about/ (internal)",
			"/ -> /species/european-rabbit/ (internal)",
			"/ -> /species/mountain-hare/ (internal)",
			"/about/ -> / (internal)",
			"/about/ -> https://bob.test/ (friend)",
			"/species/european-rabbit/ -> / (internal)",
			"/species/european-rabbit/ -> /species/mountain-hare/ (internal)",
			"/species/european-rabbit/ -> https://bob.test/regions/yorkshire/ (friend)",
			"/species/mountain-hare/ -> / (internal)",
			"/species/mountain-hare/ -> /species/european-rabbit/ (internal)",
			"/species/mountain-hare/ -> https://bob.test/regions/cotswolds (friend)",
		]);
	});

	test("bundles the graph-garden element into her pages", () => {
		const html = readFileSync(resolve(ALICE_DIST, "index.html"), "utf-8");
		expect(html).toContain("<graph-garden");
		expect(html).toMatch(/<script type="module" src="\/_astro\/.*\.js"><\/script>/);
	});
});

describe("Bob, served over HTTP", () => {
	let server: Server;
	let bobUrl: string;

	beforeAll(async () => {
		server = createServer((req, res) => {
			if (req.url === "/.well-known/graphgarden.json") {
				res.writeHead(200, {
					"Content-Type": "application/json",
					"Access-Control-Allow-Origin": "*",
				});
				res.end(BOB_JSON);
			} else {
				res.writeHead(404, { "Access-Control-Allow-Origin": "*" });
				res.end();
			}
		});
		await new Promise<void>((listening) => server.listen(0, "127.0.0.1", listening));
		const address = server.address();
		if (address && typeof address === "object") bobUrl = `http://127.0.0.1:${address.port}/`;
	});

	afterAll(() => {
		server?.close();
	});

	test("merges into a local graph through fetchFriendGraphs", async () => {
		const local: GraphGardenFile = {
			version: "0.2.0",
			generated_at: "2026-01-01T00:00:00Z",
			base_url: "https://local.test/",
			site: { title: "Local" },
			friends: [bobUrl],
			nodes: [{ url: "/", title: "Home" }],
			edges: [],
		};
		const graph = buildGraph(local, DEFAULT_CONFIG);

		await fetchFriendGraphs(graph, DEFAULT_CONFIG, local.friends);

		const titles = Object.fromEntries(graph.mapNodes((_node, { url, title }) => [url, title]));
		for (const node of bob.nodes) {
			expect(titles[new URL(node.url, bob.base_url).href]).toBe(node.title);
		}
	});
});

describe("<graph-garden> on Alice's site", () => {
	afterEach(() => {
		document.body.innerHTML = "";
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	test("renders her pages with Bob's merged in, their links to each other landing on them", async () => {
		vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
			const url = String(input);
			const body = url.includes("bob.test") ? BOB_JSON : aliceJson;
			return new Response(body, { headers: { "Content-Type": "application/json" } });
		});
		vi.spyOn(console, "warn").mockImplementation(() => {});

		const element = document.createElement("graph-garden") as GraphGarden;
		document.body.appendChild(element);
		await element.ready;

		const graph = element.graph!;
		expect(graph.mapNodes((_node, { url }) => url)).toEqual(
			expect.arrayContaining([...pagesOf(alice), ...pagesOf(bob)]),
		);
		const links = graph.filterEdges(
			(_edge, _attributes, _source, _target, from, to) => from.origin !== to.origin,
		);
		expect(links).toHaveLength(friendTargetsOf(alice).length + friendTargetsOf(bob).length);
		expect(graph.filterNodes((_node, { kind }) => kind === "frontier")).toEqual([]);
		graph.forEachNode((_node, attributes) => {
			expect(Number.isFinite(attributes.x)).toBe(true);
			expect(Number.isFinite(attributes.y)).toBe(true);
		});
	});
});
