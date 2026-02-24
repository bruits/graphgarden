import { execSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, rmSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import {
	isGraphGardenFile,
	buildGraph,
	fetchFriendGraphs,
	GraphGarden,
	DEFAULT_CONFIG,
	type GraphGardenFile,
} from "graphgarden-web";

const ROOT = resolve(import.meta.dirname, "..");
const ALICE_DIR = resolve(ROOT, "alice");
const ALICE_DIST = resolve(ALICE_DIR, "dist");
const ALICE_JSON_PATH = resolve(ALICE_DIST, ".well-known", "graphgarden.json");
const BOB_JSON_PATH = resolve(ROOT, "bob", "graphgarden.json");
const CARGO_ROOT = resolve(ROOT, "..");
const GRAPHGARDEN_BIN = resolve(CARGO_ROOT, "target", "debug", "graphgarden");
const WEB_COMPONENT_DIR = resolve(ROOT, "../packages/graphgarden-web");

describe("build pipeline", () => {
	let aliceGraph: GraphGardenFile;

	beforeAll(() => {
		if (existsSync(ALICE_DIST)) {
			rmSync(ALICE_DIST, { recursive: true });
		}

		execSync("pnpm install", { cwd: WEB_COMPONENT_DIR, stdio: "pipe" });
		execSync("pnpm run build", { cwd: WEB_COMPONENT_DIR, stdio: "pipe" });
		execSync("pnpm install", { cwd: ALICE_DIR, stdio: "pipe" });
		execSync("pnpm run build", { cwd: ALICE_DIR, stdio: "pipe" });
		execSync("cargo build", { cwd: CARGO_ROOT, stdio: "pipe" });
		execSync(`${GRAPHGARDEN_BIN} build --config graphgarden.toml`, {
			cwd: ALICE_DIR,
			stdio: "pipe",
		});

		const raw = readFileSync(ALICE_JSON_PATH, "utf-8");
		aliceGraph = JSON.parse(raw);
	});

	test("version matches protocol", () => {
		expect(aliceGraph.version).toBe("0.1.0");
	});

	test("generated_at is a valid ISO 8601 UTC timestamp", () => {
		expect(aliceGraph.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
	});

	test("base_url matches config", () => {
		expect(aliceGraph.base_url).toBe("https://alice.test/");
	});

	test("site metadata matches config", () => {
		expect(aliceGraph.site).toEqual({
			title: "Alice's Rabbits",
			description: "A guide to European rabbit species",
			language: "en",
		});
	});

	test("contains exactly 4 nodes", () => {
		expect(aliceGraph.nodes).toHaveLength(4);
	});

	test("nodes have correct URLs and titles", () => {
		const nodeMap = new Map(aliceGraph.nodes.map((n) => [n.url, n.title]));
		expect(nodeMap.get("/")).toBe("European Rabbits");
		expect(nodeMap.get("/about/")).toBe("About");
		expect(nodeMap.get("/species/european-rabbit/")).toBe("European Rabbit");
		expect(nodeMap.get("/species/mountain-hare/")).toBe("Mountain Hare");
	});

	test("no duplicate node URLs", () => {
		const urls = aliceGraph.nodes.map((n) => n.url);
		expect(new Set(urls).size).toBe(urls.length);
	});

	test("internal edges connect site pages", () => {
		const internal = aliceGraph.edges.filter((e) => e.type === "internal");
		const pairs = internal.map((e) => `${e.source} -> ${e.target}`);

		expect(pairs).toContain("/ -> /about/");
		expect(pairs).toContain("/ -> /species/european-rabbit/");
		expect(pairs).toContain("/ -> /species/mountain-hare/");
		expect(pairs).toContain("/about/ -> /");
		expect(pairs).toContain("/species/european-rabbit/ -> /");
		expect(pairs).toContain("/species/european-rabbit/ -> /species/mountain-hare/");
		expect(pairs).toContain("/species/mountain-hare/ -> /");
		expect(pairs).toContain("/species/mountain-hare/ -> /species/european-rabbit/");
	});

	test("friend edges point to Bob", () => {
		const friend = aliceGraph.edges.filter((e) => e.type === "friend");
		const pairs = friend.map((e) => `${e.source} -> ${e.target}`);

		expect(pairs).toContain("/about/ -> https://bob.test/");
		expect(pairs).toContain("/species/european-rabbit/ -> https://bob.test/regions/yorkshire/");
	});

	test("no edges to external non-friend sites", () => {
		const targets = aliceGraph.edges.map((e) => e.target);
		const external = targets.filter(
			(t) => t.startsWith("http") && !t.startsWith("https://bob.test"),
		);
		expect(external).toEqual([]);
	});

	test("no duplicate edges", () => {
		const keys = aliceGraph.edges.map((e) => `${e.source}|${e.target}|${e.type}`);
		expect(new Set(keys).size).toBe(keys.length);
	});

	test("every edge source is a known node", () => {
		const nodeUrls = new Set(aliceGraph.nodes.map((n) => n.url));
		for (const edge of aliceGraph.edges) {
			expect(nodeUrls.has(edge.source)).toBe(true);
		}
	});

	test("every internal edge target is a known node", () => {
		const nodeUrls = new Set(aliceGraph.nodes.map((n) => n.url));
		const internal = aliceGraph.edges.filter((e) => e.type === "internal");
		for (const edge of internal) {
			expect(nodeUrls.has(edge.target)).toBe(true);
		}
	});

	test("friend edge targets are absolute URLs", () => {
		const friend = aliceGraph.edges.filter((e) => e.type === "friend");
		for (const edge of friend) {
			expect(edge.target).toMatch(/^https?:\/\//);
		}
	});

	test("friends lists Bob as a friend", () => {
		expect(aliceGraph.friends).toEqual(["https://bob.test/"]);
	});

	test("Alice's friend edges target URLs that exist in Bob's graph", () => {
		const bobGraph: GraphGardenFile = JSON.parse(readFileSync(BOB_JSON_PATH, "utf-8"));

		const bobNodeUrls = new Set(
			bobGraph.nodes.map((n) => `${bobGraph.base_url}${n.url.replace(/^\//, "")}`),
		);

		const aliceFriendTargets = aliceGraph.edges
			.filter((e) => e.type === "friend")
			.map((e) => e.target);

		for (const target of aliceFriendTargets) {
			expect(bobNodeUrls.has(target)).toBe(true);
		}
	});

	test("Bob's friend edges target URLs that exist in Alice's graph", () => {
		const bobGraph: GraphGardenFile = JSON.parse(readFileSync(BOB_JSON_PATH, "utf-8"));

		const aliceNodeUrls = new Set(
			aliceGraph.nodes.map((n) => `${aliceGraph.base_url}${n.url.replace(/^\//, "")}`),
		);

		const bobFriendTargets = bobGraph.edges.filter((e) => e.type === "friend").map((e) => e.target);

		for (const target of bobFriendTargets) {
			expect(aliceNodeUrls.has(target)).toBe(true);
		}
	});
});

describe("bob mock server", () => {
	let server: ReturnType<typeof createServer>;
	let bobUrl: string;
	let bobGraph: GraphGardenFile;

	beforeAll(async () => {
		const bobJson = readFileSync(BOB_JSON_PATH, "utf-8");
		bobGraph = JSON.parse(bobJson);

		server = createServer((req, res) => {
			if (req.method === "OPTIONS") {
				res.writeHead(204, { "Access-Control-Allow-Origin": "*" });
				res.end();
				return;
			}

			if (req.url === "/.well-known/graphgarden.json") {
				res.writeHead(200, {
					"Content-Type": "application/json",
					"Access-Control-Allow-Origin": "*",
				});
				res.end(bobJson);
			} else {
				res.writeHead(404, { "Access-Control-Allow-Origin": "*" });
				res.end();
			}
		});

		await new Promise<void>((resolve) => {
			server.listen(0, "127.0.0.1", () => resolve());
		});

		const addr = server.address();
		if (addr && typeof addr === "object") {
			bobUrl = `http://127.0.0.1:${addr.port}`;
		}
	});

	afterAll(() => {
		server?.close();
	});

	test("serves graphgarden.json at well-known path", async () => {
		const res = await fetch(`${bobUrl}/.well-known/graphgarden.json`);
		expect(res.status).toBe(200);
		expect(res.headers.get("access-control-allow-origin")).toBe("*");

		const data = await res.json();
		expect(data.version).toBe("0.1.0");
		expect(data.base_url).toBe("https://bob.test/");
		expect(data.site.title).toBe("Bob's Your Uncle");
	});

	test("Bob's mock data is a valid protocol file", () => {
		expect(bobGraph.version).toBe("0.1.0");
		expect(bobGraph.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
		expect(bobGraph.nodes.length).toBeGreaterThan(0);
		expect(bobGraph.edges.length).toBeGreaterThan(0);
	});

	test("returns 404 for other paths", async () => {
		const res = await fetch(`${bobUrl}/other`);
		expect(res.status).toBe(404);
	});

	test("fetchFriendGraphs merges Bob's nodes into a local graph", async () => {
		const localFile: GraphGardenFile = {
			version: "0.1.0",
			generated_at: "2025-01-01T00:00:00Z",
			base_url: "https://local.test/",
			site: { title: "Local" },
			friends: [`${bobUrl}/`],
			nodes: [{ url: "/", title: "Home" }],
			edges: [{ source: "/", target: `${bobUrl}/`, type: "friend" }],
		};
		const graph = buildGraph(localFile, DEFAULT_CONFIG);

		await fetchFriendGraphs(graph, DEFAULT_CONFIG, localFile.friends);

		for (const node of bobGraph.nodes) {
			const absoluteUrl = new URL(node.url, bobGraph.base_url).href;
			expect(graph.hasNode(absoluteUrl)).toBe(true);
			expect(graph.getNodeAttribute(absoluteUrl, "title")).toBe(node.title);
		}

		const bobInternal = bobGraph.edges.filter((e) => e.type === "internal");
		for (const edge of bobInternal) {
			const source = new URL(edge.source, bobGraph.base_url).href;
			const target = new URL(edge.target, bobGraph.base_url).href;
			expect(graph.hasDirectedEdge(source, target)).toBe(true);
		}
	});
});

describe("web component compatibility", () => {
	test("Alice's generated file passes web component validation", () => {
		const raw = readFileSync(ALICE_JSON_PATH, "utf-8");
		const data: unknown = JSON.parse(raw);
		expect(isGraphGardenFile(data)).toBe(true);
	});

	test("Alice's file builds a valid graph", () => {
		const raw = readFileSync(ALICE_JSON_PATH, "utf-8");
		const file = JSON.parse(raw) as GraphGardenFile;
		const graph = buildGraph(file, DEFAULT_CONFIG);

		for (const node of file.nodes) {
			const absoluteUrl = new URL(node.url, file.base_url).href;
			expect(graph.hasNode(absoluteUrl)).toBe(true);
			expect(graph.getNodeAttribute(absoluteUrl, "title")).toBe(node.title);
		}

		expect(graph.size).toBe(file.edges.length);
		for (const edge of file.edges) {
			const absoluteSource = new URL(edge.source, file.base_url).href;
			const absoluteTarget = new URL(edge.target, file.base_url).href;
			expect(graph.hasDirectedEdge(absoluteSource, absoluteTarget)).toBe(true);
		}

		expect(graph.getAttribute("base_url")).toBe(file.base_url);
		expect(graph.getAttribute("site")).toEqual(file.site);
	});

	test("Bob's static file passes web component validation", () => {
		const raw = readFileSync(BOB_JSON_PATH, "utf-8");
		const data: unknown = JSON.parse(raw);
		expect(isGraphGardenFile(data)).toBe(true);
	});

	test("Bob's file builds a valid graph", () => {
		const raw = readFileSync(BOB_JSON_PATH, "utf-8");
		const file = JSON.parse(raw) as GraphGardenFile;
		const graph = buildGraph(file, DEFAULT_CONFIG);

		for (const node of file.nodes) {
			const absoluteUrl = new URL(node.url, file.base_url).href;
			expect(graph.hasNode(absoluteUrl)).toBe(true);
			expect(graph.getNodeAttribute(absoluteUrl, "title")).toBe(node.title);
		}

		expect(graph.size).toBe(file.edges.length);
		for (const edge of file.edges) {
			const absoluteSource = new URL(edge.source, file.base_url).href;
			const absoluteTarget = new URL(edge.target, file.base_url).href;
			expect(graph.hasDirectedEdge(absoluteSource, absoluteTarget)).toBe(true);
		}

		expect(graph.getAttribute("base_url")).toBe(file.base_url);
		expect(graph.getAttribute("site")).toEqual(file.site);
	});
});

describe("web component rendering", () => {
	test("Alice's built index.html contains the graph-garden element", () => {
		const html = readFileSync(resolve(ALICE_DIST, "index.html"), "utf-8");
		expect(html).toContain("<graph-garden");
		expect(html).toMatch(/<script type="module" src="\/_astro\/.*\.js"><\/script>/);
	});

	test("web component loads graph and computes layout from Alice's JSON", async () => {
		const aliceJson = readFileSync(ALICE_JSON_PATH, "utf-8");
		const bobJson = readFileSync(BOB_JSON_PATH, "utf-8");
		const aliceFile = JSON.parse(aliceJson) as GraphGardenFile;
		const bobFile = JSON.parse(bobJson) as GraphGardenFile;

		const originalFetch = globalThis.fetch;
		globalThis.fetch = async (input: RequestInfo | URL) => {
			const url = typeof input === "string" ? input : input.toString();
			if (url.endsWith("/.well-known/graphgarden.json")) {
				if (url.includes("bob.test")) {
					return new Response(bobJson, {
						status: 200,
						headers: { "Content-Type": "application/json" },
					});
				}
				return new Response(aliceJson, {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			}
			return new Response(null, { status: 404 });
		};

		try {
			const element = document.createElement("graph-garden") as InstanceType<typeof GraphGarden>;
			document.body.appendChild(element);

			await new Promise((resolve) => setTimeout(resolve, 100));

			expect(element.graph).not.toBeNull();
			expect(element.graph!.order).toBeGreaterThan(0);

			element.graph!.forEachNode((_node, attrs) => {
				expect(attrs.x).toBeTypeOf("number");
				expect(attrs.y).toBeTypeOf("number");
			});

			// Verify Alice's nodes
			for (const node of aliceFile.nodes) {
				const absoluteUrl = new URL(node.url, aliceFile.base_url).href;
				expect(element.graph!.hasNode(absoluteUrl)).toBe(true);
			}

			// Verify Bob's nodes were merged via fetchFriendGraphs
			for (const node of bobFile.nodes) {
				const absoluteUrl = new URL(node.url, bobFile.base_url).href;
				expect(element.graph!.hasNode(absoluteUrl)).toBe(true);
				expect(element.graph!.getNodeAttribute(absoluteUrl, "title")).toBe(node.title);
			}

			element.remove();
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
