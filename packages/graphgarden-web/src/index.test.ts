import { describe, test, expect, vi, afterEach, beforeEach } from "vitest";
import Graph from "graphology";
import type { NodeCircleProgram } from "sigma/rendering";
import { DEFAULT_SETTINGS, type Settings } from "sigma/settings";
import {
	isGraphGardenFile,
	buildGraph,
	fetchFriendGraphs,
	assignLayout,
	assignNodeSizes,
	type GraphGardenFile,
	type GraphGarden,
	DEFAULT_CONFIG,
} from "./index.js";

interface SigmaPayload {
	node?: string;
	event?: { original: { type: string } };
}

// Sigma needs WebGL, which happy-dom lacks
const { renderers, FakeSigma } = vi.hoisted(() => {
	const created: Fake[] = [];
	class Fake {
		handlers = new Map<string, (payload: SigmaPayload) => void>();
		killed = false;
		refreshes = 0;
		frames: string[][] = [];
		/** The camera ratio, above 1 when zoomed out. */
		ratio = 1;
		constructor(
			readonly graph: Graph,
			_container: HTMLElement,
			readonly settings: Partial<Settings>,
		) {
			created.push(this);
			// Sigma draws its first frame in its constructor
			this.render();
		}
		on(event: string, handler: (payload: SigmaPayload) => void) {
			this.handlers.set(event, handler);
			return this;
		}
		refresh({ schedule, partialGraph }: { schedule?: boolean; partialGraph?: unknown } = {}) {
			// Counts full refreshes, which a change of look asks for
			if (partialGraph === undefined) this.refreshes++;
			// Sigma renders at once unless asked to schedule
			if (!schedule) this.render();
		}
		zoom(ratio: number) {
			this.ratio = ratio;
			this.render();
		}
		render() {
			this.handlers.get("beforeRender")?.({});
			this.frames.push(labelsDrawn(this, { ...DEFAULT_SETTINGS, ...this.settings }));
		}
		kill() {
			this.killed = true;
		}
		getDimensions() {
			return { width: 800, height: 600 };
		}
		getNodeDisplayData(node: string) {
			const attributes = this.graph.getNodeAttributes(node);
			return this.settings.nodeReducer?.(node, attributes) ?? attributes;
		}
		// Graph coordinates stand in for viewport ones
		framedGraphToViewport({ x, y }: { x: number; y: number }) {
			return { x, y };
		}
		scaleSize(size = 1) {
			return size / this.settings.zoomToSizeRatioFunction!(this.ratio);
		}
	}
	return { renderers: created, FakeSigma: Fake };
});
vi.mock("sigma", () => ({ default: FakeSigma }));

const LOCAL = "https://local.test/";
const FRIEND = "https://friend.test/";

function makeFile(overrides: Partial<GraphGardenFile> = {}): GraphGardenFile {
	return {
		version: "0.2.0",
		generated_at: "2026-01-01T00:00:00Z",
		base_url: LOCAL,
		site: { title: "Local" },
		friends: [],
		nodes: [{ url: "/", title: "Home" }],
		edges: [],
		...overrides,
	};
}

function friendFile(overrides: Partial<GraphGardenFile> = {}): GraphGardenFile {
	return makeFile({
		base_url: FRIEND,
		site: { title: "Friend" },
		nodes: [
			{ url: "/", title: "Friend Home" },
			{ url: "/blog/", title: "Friend Blog" },
		],
		edges: [{ source: "/", target: "/blog/", type: "internal" }],
		...overrides,
	});
}

function without(file: GraphGardenFile, key: keyof GraphGardenFile): unknown {
	const copy: Record<string, unknown> = { ...file };
	delete copy[key];
	return copy;
}

function serve(route: (url: string) => unknown) {
	const fetchMock = vi.fn(
		async (input: RequestInfo | URL, _init?: RequestInit) =>
			({ ok: true, json: async () => route(String(input)) }) as Response,
	);
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

function hangingFetch(_input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	return new Promise((_resolve, reject) => {
		init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
	});
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => (resolve = r));
	return { promise, resolve };
}

function mount(configure: (element: GraphGarden) => void = () => {}): GraphGarden {
	const element = document.createElement("graph-garden") as GraphGarden;
	configure(element);
	document.body.appendChild(element);
	return element;
}

/** A 2D context recording the text and rings drawn on it, since happy-dom has no canvas. */
function recordingContext(glyphWidth = 6) {
	const texts: {
		text: string;
		x: number;
		y: number;
		font: string;
		letterSpacing: string;
		textAlign: string;
		textBaseline: string;
		ink: string;
		alpha: number;
	}[] = [];
	const halos: { text: string; color: string }[] = [];
	const rings: { radius: number; color: string }[] = [];
	let radius = 0;
	const context = {
		font: "",
		letterSpacing: "0px",
		textAlign: "start",
		textBaseline: "alphabetic",
		lineJoin: "miter",
		lineWidth: 1,
		strokeStyle: "",
		fillStyle: "",
		globalAlpha: 1,
		save() {},
		restore() {},
		beginPath() {},
		arc(_x: number, _y: number, r: number) {
			radius = r;
		},
		stroke() {
			rings.push({ radius, color: this.strokeStyle });
		},
		strokeText(text: string) {
			halos.push({ text, color: this.strokeStyle });
		},
		measureText(text: string) {
			return { width: text.length * glyphWidth };
		},
		fillText(text: string, x: number, y: number) {
			texts.push({
				text,
				x,
				y,
				font: this.font,
				letterSpacing: this.letterSpacing,
				textAlign: this.textAlign,
				textBaseline: this.textBaseline,
				ink: this.fillStyle,
				alpha: this.globalAlpha,
			});
		},
	};
	return { context: context as unknown as CanvasRenderingContext2D, texts, halos, rings };
}

function pointer(type: string) {
	return { original: { type } };
}

function labelData(key: string, label: string | null, tier: string) {
	return { key, label, title: label, tier, x: 100, y: 50, size: 6, color: "#ff0000" };
}

function place(graph: Graph, positions: Record<string, [number, number]>) {
	for (const [node, [x, y]] of Object.entries(positions)) graph.mergeNodeAttributes(node, { x, y });
}

function drawnLabels(settings: Settings, glyphWidth?: number): string[] {
	const sigma = renderers[0];
	sigma.handlers.get("beforeRender")!({});
	return labelsDrawn(sigma, settings, glyphWidth);
}

/** Offers the drawer only the nodes with a forced label, as Sigma does when its label grid keeps none. */
function labelsDrawn(
	sigma: (typeof renderers)[number],
	settings: Settings,
	glyphWidth?: number,
): string[] {
	const { context, texts } = recordingContext(glyphWidth);
	return sigma.graph.filterNodes((node, attributes) => {
		if (!sigma.getNodeDisplayData(node).forceLabel) return false;
		const before = texts.length;
		const data = {
			...attributes,
			label: attributes.label,
			key: node,
			x: 0,
			y: 0,
			size: 6,
			color: "",
		};
		settings.defaultDrawNodeLabel(context, data, settings);
		return texts.length > before;
	});
}

function twoSitesAndAStray(): Graph {
	const graph = new Graph();
	for (const site of ["a", "b"]) {
		graph.addNode(site, { origin: site });
		for (let leaf = 0; leaf < 5; leaf++) {
			graph.addNode(`${site}${leaf}`, { origin: site });
			graph.addEdge(site, `${site}${leaf}`);
		}
	}
	graph.addEdge("a", "b");
	graph.addNode("stray", { origin: "a" });
	return graph;
}

function distance(graph: Graph, a: string, b: string): number {
	const [p, q] = [graph.getNodeAttributes(a), graph.getNodeAttributes(b)];
	return Math.hypot(p.x - q.x, p.y - q.y);
}

// mulberry32, so a layout comes out the same every run
function seededRandom(seed: number): () => number {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function shaderDeclarations(source: string, qualifier: string): string[] {
	return [...source.matchAll(new RegExp(`^${qualifier} (\\w+ \\w+);`, "gm"))].map(
		(match) => match[1],
	);
}

afterEach(() => {
	document.body.innerHTML = "";
	renderers.length = 0;
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("isGraphGardenFile", () => {
	test.each([
		["a complete file", makeFile({ friends: [FRIEND] })],
		["a file without friends, as in protocol 0.1.0", without(makeFile(), "friends")],
		[
			"a site with description and language",
			makeFile({ site: { title: "T", description: "D", language: "en" } }),
		],
		["empty nodes and edges", makeFile({ nodes: [], edges: [] })],
	])("accepts %s", (_label, value) => {
		expect(isGraphGardenFile(value)).toBe(true);
	});

	test.each([
		["null", null],
		["a string", "hello"],
		["a missing version", without(makeFile(), "version")],
		["a missing generated_at", without(makeFile(), "generated_at")],
		["a missing base_url", without(makeFile(), "base_url")],
		["a relative base_url", { ...makeFile(), base_url: "/" }],
		["a javascript: base_url", { ...makeFile(), base_url: "javascript:alert(1)" }],
		["a missing site", without(makeFile(), "site")],
		["a site without title", { ...makeFile(), site: {} }],
		["a non-string description", { ...makeFile(), site: { title: "T", description: 42 } }],
		["a non-string language", { ...makeFile(), site: { title: "T", language: true } }],
		["a non-string friend", { ...makeFile(), friends: [FRIEND, 42] }],
		["a node without url", { ...makeFile(), nodes: [{ title: "No URL" }] }],
		["a node without title", { ...makeFile(), nodes: [{ url: "/" }] }],
		["an edge without source", { ...makeFile(), edges: [{ target: "/", type: "internal" }] }],
		[
			"an edge of unknown type",
			{ ...makeFile(), edges: [{ source: "/", target: "/", type: "x" }] },
		],
	])("rejects %s", (_label, value) => {
		expect(isGraphGardenFile(value)).toBe(false);
	});
});

describe("buildGraph", () => {
	test("keys nodes by absolute URL and keeps the site attributes", () => {
		const graph = buildGraph(
			makeFile({ nodes: [{ url: "/about/", title: "About" }] }),
			DEFAULT_CONFIG,
		);

		expect(graph.getNodeAttributes(`${LOCAL}about/`)).toMatchObject({
			title: "About",
			label: "About",
			size: DEFAULT_CONFIG.nodeSize,
			color: DEFAULT_CONFIG.localNodeColor,
		});
		expect(graph.getAttribute("base_url")).toBe(LOCAL);
		expect(graph.getAttribute("site")).toEqual({ title: "Local" });
	});

	test.each([
		["drops the site's name after a separator", "Images - Docs - Local", "Images - Docs"],
		["drops the site's name before a separator", "Local | About", "About"],
		["drops the site's name whatever its case", "Notes · LOCAL", "Notes"],
		["keeps a title that is the site's name alone", "Local", "Local"],
		[
			"cuts a long title after a word, with an ellipsis",
			"The still scrolls of the web, unchanging and steadfast",
			"The still scrolls of the web…",
		],
		[
			"keeps a word that ends right at the cut",
			"Notes on gardening and the web forever",
			"Notes on gardening and the web…",
		],
		[
			"keeps a word that ends right at the cut before punctuation",
			"Notes on gardening and the web, forever",
			"Notes on gardening and the web…",
		],
		[
			"keeps the start of a word that punctuation splits at the cut",
			"Notes on gardening on any well-known path",
			"Notes on gardening on any well…",
		],
		[
			"cuts after a word at any space",
			"The still\u00a0scrolls of the web,\u00a0unchanging",
			"The still\u00a0scrolls of the web…",
		],
		[
			"cuts a long word where it must",
			"Pneumonoultramicroscopicsilicovolcanoconiosis",
			"Pneumonoultramicroscopicsilico…",
		],
		["keeps a flag whole at the cut", `${"a".repeat(29)}🇫🇷bcd`, `${"a".repeat(29)}🇫🇷…`],
		["keeps a joined emoji whole at the cut", `${"a".repeat(29)}👨‍👩‍👧‍👦bcd`, `${"a".repeat(29)}👨‍👩‍👧‍👦…`],
		[
			"keeps an accent with its letter at the cut",
			`${"a".repeat(29)}e\u0301bcd`,
			`${"a".repeat(29)}e\u0301…`,
		],
	])("labels a page with its short title: %s", (_label, title, label) => {
		const graph = buildGraph(makeFile({ nodes: [{ url: "/page/", title }] }), DEFAULT_CONFIG);

		expect(graph.getNodeAttributes(`${LOCAL}page/`)).toMatchObject({ title, label });
	});

	test("keeps the site's name in its home page's label", () => {
		const graph = buildGraph(
			makeFile({ nodes: [{ url: "/", title: "Local - A small garden" }] }),
			DEFAULT_CONFIG,
		);

		expect(graph.getNodeAttribute(LOCAL, "label")).toBe("Local - A small garden");
	});

	test("colours pages and links by who describes them, grey where nobody does", () => {
		const graph = buildGraph(
			makeFile({
				nodes: [
					{ url: "/", title: "Home" },
					{ url: "/about/", title: "About" },
				],
				edges: [
					{ source: "/", target: "/about/", type: "internal" },
					{ source: "/", target: "/missing", type: "internal" },
					{ source: "/", target: FRIEND, type: "friend" },
				],
			}),
			DEFAULT_CONFIG,
		);

		const edgeColor = (target: string) =>
			graph.getEdgeAttribute(graph.directedEdge(LOCAL, target)!, "color");
		expect(edgeColor(`${LOCAL}about/`)).toBe(DEFAULT_CONFIG.localEdgeColor);
		expect(edgeColor(`${LOCAL}missing`)).toBe(DEFAULT_CONFIG.frontierEdgeColor);
		expect(edgeColor(FRIEND)).toBe(DEFAULT_CONFIG.frontierEdgeColor);
		expect(graph.getNodeAttribute(`${LOCAL}about/`, "color")).toBe(DEFAULT_CONFIG.localNodeColor);
		expect(graph.getNodeAttribute(`${LOCAL}missing`, "color")).toBe(
			DEFAULT_CONFIG.frontierNodeColor,
		);
		expect(graph.getNodeAttribute(FRIEND, "color")).toBe(DEFAULT_CONFIG.frontierNodeColor);
	});

	test("applies a custom config", () => {
		const config = { ...DEFAULT_CONFIG, localNodeColor: "#ff0000", nodeSize: 10, edgeSize: 2 };
		const graph = buildGraph(
			makeFile({ edges: [{ source: "/", target: FRIEND, type: "friend" }] }),
			config,
		);

		expect(graph.getNodeAttributes(LOCAL)).toMatchObject({ color: "#ff0000", size: 10 });
		expect(graph.getEdgeAttribute(graph.edges()[0], "size")).toBe(2);
	});

	test("draws each site's home page as a ring, described or not", () => {
		const graph = buildGraph(
			makeFile({
				nodes: [
					{ url: "/", title: "Home" },
					{ url: "/about/", title: "About" },
					{ url: "/?page=2", title: "Page 2" },
				],
				edges: [
					{ source: "/", target: "https://charlie.test", type: "friend" },
					{ source: "/", target: "https://charlie.test/blog/", type: "friend" },
				],
			}),
			DEFAULT_CONFIG,
		);

		expect(Object.fromEntries(graph.mapNodes((node, { type }) => [node, type]))).toEqual({
			[LOCAL]: "home",
			[`${LOCAL}about/`]: "circle",
			[`${LOCAL}?page=2`]: "circle",
			"https://charlie.test/": "home",
			"https://charlie.test/blog/": "circle",
		});
	});

	test("skips nodes and edges whose URL is not http or https", () => {
		const graph = buildGraph(
			makeFile({
				nodes: [
					{ url: "/", title: "Home" },
					{ url: "javascript:alert(1)", title: "Evil" },
				],
				edges: [
					{ source: "/", target: "data:text/html,<script>alert(1)</script>", type: "internal" },
					{ source: "javascript:alert(1)", target: "/", type: "internal" },
				],
			}),
			DEFAULT_CONFIG,
		);

		expect(graph.nodes()).toEqual([LOCAL]);
		expect(graph.size).toBe(0);
	});

	test("skips edges whose source the file does not declare", () => {
		const graph = buildGraph(
			makeFile({ edges: [{ source: "/ghost", target: "/", type: "internal" }] }),
			DEFAULT_CONFIG,
		);

		expect(graph.nodes()).toEqual([LOCAL]);
		expect(graph.size).toBe(0);
	});
});

describe("fetchFriendGraphs", () => {
	test("merges a friend's pages and links in friend colours", async () => {
		const graph = buildGraph(
			makeFile({ friends: [FRIEND], edges: [{ source: "/", target: FRIEND, type: "friend" }] }),
			DEFAULT_CONFIG,
		);
		serve(() => friendFile());

		await fetchFriendGraphs(graph, DEFAULT_CONFIG, [FRIEND]);

		expect(graph.getNodeAttributes(FRIEND)).toMatchObject({
			title: "Friend Home",
			color: DEFAULT_CONFIG.friendNodeColor,
		});
		expect(graph.getNodeAttribute(`${FRIEND}blog/`, "title")).toBe("Friend Blog");
		const friendEdge = graph.directedEdge(FRIEND, `${FRIEND}blog/`)!;
		expect(graph.getEdgeAttribute(friendEdge, "color")).toBe(DEFAULT_CONFIG.friendEdgeColor);
	});

	test("labels a friend's page without the friend's own site name", async () => {
		const graph = buildGraph(makeFile(), DEFAULT_CONFIG);
		serve(() => friendFile({ nodes: [{ url: "/blog/", title: "Blog - Friend" }], edges: [] }));

		await fetchFriendGraphs(graph, DEFAULT_CONFIG, [FRIEND]);

		expect(graph.getNodeAttributes(`${FRIEND}blog/`)).toMatchObject({
			title: "Blog - Friend",
			label: "Blog",
		});
	});

	test("recolours the links to a page once a later file describes it", async () => {
		const graph = buildGraph(
			makeFile({ friends: [FRIEND], edges: [{ source: "/", target: FRIEND, type: "friend" }] }),
			DEFAULT_CONFIG,
		);
		const link = graph.directedEdge(LOCAL, FRIEND)!;
		expect(graph.getEdgeAttribute(link, "color")).toBe(DEFAULT_CONFIG.frontierEdgeColor);
		serve(() => friendFile());

		await fetchFriendGraphs(graph, DEFAULT_CONFIG, [FRIEND]);

		expect(graph.getNodeAttribute(FRIEND, "color")).toBe(DEFAULT_CONFIG.friendNodeColor);
		expect(graph.getEdgeAttribute(link, "color")).toBe(DEFAULT_CONFIG.friendEdgeColor);
	});

	test("fetches each friend origin once, linked or not", async () => {
		const fetchMock = serve(() => friendFile());

		await fetchFriendGraphs(buildGraph(makeFile(), DEFAULT_CONFIG), DEFAULT_CONFIG, [
			FRIEND,
			`${FRIEND}blog/`,
		]);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0][0]).toBe(`${FRIEND}.well-known/graphgarden.json`);
	});

	test("does not fetch without friends", async () => {
		const fetchMock = serve(() => friendFile());
		await fetchFriendGraphs(buildGraph(makeFile(), DEFAULT_CONFIG), DEFAULT_CONFIG, []);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	test.each([
		["unreachable", () => Promise.reject(new Error("Network error"))],
		[
			"answering 404",
			async () => ({ ok: false, status: 404, statusText: "Not Found" }) as Response,
		],
		[
			"serving an invalid file",
			async () => ({ ok: true, json: async () => ({ invalid: true }) }) as Response,
		],
		[
			"serving a javascript: base_url",
			async () =>
				({
					ok: true,
					json: async () => friendFile({ base_url: "javascript:alert(1)" }),
				}) as Response,
		],
	])("skips a friend %s and keeps its frontier colour", async (_label, fetchImpl) => {
		const graph = buildGraph(
			makeFile({ friends: [FRIEND], edges: [{ source: "/", target: FRIEND, type: "friend" }] }),
			DEFAULT_CONFIG,
		);
		vi.stubGlobal("fetch", vi.fn(fetchImpl));
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		await fetchFriendGraphs(graph, DEFAULT_CONFIG, [FRIEND]);

		expect(graph.order).toBe(2);
		expect(graph.getNodeAttribute(FRIEND, "color")).toBe(DEFAULT_CONFIG.frontierNodeColor);
		expect(graph.getEdgeAttribute(graph.edges()[0], "color")).toBe(
			DEFAULT_CONFIG.frontierEdgeColor,
		);
		expect(warn).toHaveBeenCalled();
	});

	test("gives up on a friend that does not answer within 10 seconds", async () => {
		vi.useFakeTimers();
		vi.stubGlobal("fetch", vi.fn(hangingFetch));
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const graph = buildGraph(makeFile(), DEFAULT_CONFIG);

		const done = fetchFriendGraphs(graph, DEFAULT_CONFIG, [FRIEND]);
		let settled = false;
		void done.then(() => (settled = true));
		await vi.advanceTimersByTimeAsync(9_999);
		expect(settled).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		await done;

		expect(warn).toHaveBeenCalled();
		expect(graph.order).toBe(1);
	});

	test("leaves a friend's links to sites nobody describes in grey", async () => {
		const charlie = "https://charlie.test/";
		const graph = buildGraph(makeFile(), DEFAULT_CONFIG);
		serve(() =>
			friendFile({
				edges: [
					{ source: "/", target: charlie, type: "friend" },
					{ source: "/", target: LOCAL, type: "friend" },
				],
			}),
		);

		await fetchFriendGraphs(graph, DEFAULT_CONFIG, [FRIEND]);

		const edgeColor = (target: string) =>
			graph.getEdgeAttribute(graph.directedEdge(FRIEND, target)!, "color");
		expect(graph.getNodeAttribute(charlie, "color")).toBe(DEFAULT_CONFIG.frontierNodeColor);
		expect(edgeColor(charlie)).toBe(DEFAULT_CONFIG.frontierEdgeColor);
		expect(graph.getNodeAttribute(LOCAL, "color")).toBe(DEFAULT_CONFIG.localNodeColor);
		expect(edgeColor(LOCAL)).toBe(DEFAULT_CONFIG.friendEdgeColor);
	});

	test("ignores a friend's claims on local pages", async () => {
		const impostor = "https://impostor.test/";
		const graph = buildGraph(makeFile(), DEFAULT_CONFIG);
		serve((url) =>
			url.startsWith(impostor)
				? makeFile({ nodes: [{ url: "/", title: "Pwned" }] })
				: friendFile({
						nodes: [
							{ url: "/", title: "Friend Home" },
							{ url: LOCAL, title: "Pwned" },
						],
						edges: [{ source: LOCAL, target: FRIEND, type: "friend" }],
					}),
		);
		vi.spyOn(console, "warn").mockImplementation(() => {});

		await fetchFriendGraphs(graph, DEFAULT_CONFIG, [FRIEND, impostor]);

		expect(graph.getNodeAttributes(LOCAL)).toMatchObject({
			title: "Home",
			color: DEFAULT_CONFIG.localNodeColor,
		});
		expect(graph.hasDirectedEdge(LOCAL, FRIEND)).toBe(false);
	});

	test("skips a friend's nodes and edges whose URL is not http or https", async () => {
		const graph = buildGraph(makeFile(), DEFAULT_CONFIG);
		serve(() =>
			friendFile({
				nodes: [
					{ url: "/", title: "Friend Home" },
					{ url: "javascript:alert(1)", title: "Evil" },
				],
				edges: [
					{ source: "/", target: "data:text/html,<script>alert(1)</script>", type: "internal" },
				],
			}),
		);

		await fetchFriendGraphs(graph, DEFAULT_CONFIG, [FRIEND]);

		expect(graph.nodes().toSorted()).toEqual([FRIEND, LOCAL]);
		expect(graph.size).toBe(0);
	});
});

describe("assignLayout", () => {
	test("positions every node, with or without an iteration count", () => {
		for (const iterations of [undefined, 5]) {
			const graph = buildGraph(
				makeFile({
					nodes: [
						{ url: "/a", title: "A" },
						{ url: "/b", title: "B" },
					],
					edges: [{ source: "/a", target: "/b", type: "internal" }],
				}),
				DEFAULT_CONFIG,
			);

			assignLayout(graph, iterations);

			graph.forEachNode((_node, attributes) => {
				expect(Number.isFinite(attributes.x)).toBe(true);
				expect(Number.isFinite(attributes.y)).toBe(true);
			});
		}
	});

	test("positions a graph large enough for Barnes-Hut", () => {
		const graph = new Graph();
		for (let i = 0; i < 1000; i++) graph.addNode(String(i));
		for (let i = 1; i < 1000; i++) graph.addEdge(String(i - 1), String(i));

		assignLayout(graph, 1);

		graph.forEachNode((_node, attributes) => {
			expect(Number.isFinite(attributes.x)).toBe(true);
		});
	});

	test("leaves an empty graph alone", () => {
		expect(() => assignLayout(new Graph())).not.toThrow();
	});

	test.each([1, 2, 3, 4, 5])(
		"lays a page linked to nothing beside its own site, seed %i",
		(seed) => {
			vi.spyOn(Math, "random").mockImplementation(seededRandom(seed));
			const graph = twoSitesAndAStray();

			assignLayout(graph);

			expect(distance(graph, "stray", "a")).toBeLessThan(distance(graph, "stray", "b"));
		},
	);

	test.each([1, 2, 3, 4, 5])(
		"lays stray pages beside their site, not beside a link they share with the map, seed %i",
		(seed) => {
			vi.spyOn(Math, "random").mockImplementation(seededRandom(seed));
			// Local pages lead in a chain to a friend's home, and link to a GitHub page too
			const graph = new Graph();
			const page = (node: string, kind: string, origin: string) =>
				graph.addNode(node, { kind, origin });
			for (const node of ["home", "l1", "l2", "l3"]) page(node, "local", "local");
			for (const node of ["friend", "f1", "f2", "f3", "p1", "p2"]) page(node, "friend", "friend");
			for (const node of ["github/y", "github/x"]) page(node, "frontier", "github");
			for (const [source, target] of [
				["home", "l1"],
				["l1", "l2"],
				["l2", "l3"],
				["l3", "friend"],
				["home", "github/y"],
				["friend", "f1"],
				["friend", "f2"],
				["friend", "f3"],
				// Two friend pages link only to another GitHub page, better connected than either
				["p1", "github/x"],
				["p2", "github/x"],
			]) {
				graph.addEdge(source, target);
			}

			assignLayout(graph);

			expect(distance(graph, "p1", "friend")).toBeLessThan(distance(graph, "p1", "github/y"));
		},
	);

	test("leaves no trace of the links it lays stray pages out with", () => {
		const graph = twoSitesAndAStray();
		const edges = graph.edges();

		assignLayout(graph, 5);

		expect(graph.edges()).toEqual(edges);
		expect(graph.degree("stray")).toBe(0);
	});

	test("leaves no trace of those links when the layout fails", () => {
		const graph = twoSitesAndAStray();
		const edges = graph.edges();

		// ForceAtlas2 rejects a count of zero iterations
		expect(() => assignLayout(graph, 0)).toThrow();

		expect(graph.edges()).toEqual(edges);
	});
});

describe("assignNodeSizes", () => {
	test.each<[string, [string, string][], Record<string, number>]>([
		[
			"keeps every node at nodeSize when degrees are equal",
			[
				["a", "b"],
				["b", "c"],
				["c", "a"],
			],
			{ a: 4, b: 4, c: 4 },
		],
		[
			"grows nodes above the median by half and above the ninth decile twice",
			[
				["hub", "a"],
				["hub", "b"],
				["hub", "c"],
				["hub", "d"],
				["hub", "mid"],
				["mid", "e"],
				["mid", "f"],
			],
			{ hub: 8, mid: 6, a: 4, b: 4, c: 4, d: 4, e: 4, f: 4 },
		],
		[
			"gives nodes of equal degree the same size",
			[
				["h", "a"],
				["h", "b"],
				["h", "c"],
				["k", "d"],
				["k", "e"],
				["k", "f"],
			],
			{ h: 6, k: 6, a: 4, b: 4, c: 4, d: 4, e: 4, f: 4 },
		],
		[
			"ignores self-loops",
			[
				["a", "a"],
				["a", "b"],
			],
			{ a: 4, b: 4 },
		],
	])("%s", (_label, edges, expected) => {
		const graph = new Graph();
		for (const [source, target] of edges) graph.mergeDirectedEdge(source, target);

		assignNodeSizes(graph, 4);

		expect(Object.fromEntries(graph.mapNodes((node, { size }) => [node, size]))).toEqual(expected);
	});

	test("marks each node with its tier", () => {
		const graph = new Graph();
		for (const leaf of ["a", "b", "c", "d", "mid"]) graph.mergeDirectedEdge("hub", leaf);
		for (const leaf of ["e", "f"]) graph.mergeDirectedEdge("mid", leaf);

		assignNodeSizes(graph, 4);

		expect(graph.getNodeAttribute("hub", "tier")).toBe("large");
		expect(graph.getNodeAttribute("mid", "tier")).toBe("medium");
		expect(graph.getNodeAttribute("a", "tier")).toBe("small");
	});
});

describe("<graph-garden>", () => {
	test("renders the local graph with its friends merged in", async () => {
		serve((url) => (url.startsWith(FRIEND) ? friendFile() : makeFile({ friends: [FRIEND] })));

		const element = mount();
		await element.ready;

		expect(element.graph!.hasNode(LOCAL)).toBe(true);
		expect(element.graph!.hasNode(`${FRIEND}blog/`)).toBe(true);
		element.graph!.forEachNode((_node, attributes) => {
			expect(Number.isFinite(attributes.x)).toBe(true);
		});
		expect(renderers).toHaveLength(1);
		expect(renderers[0].graph).toBe(element.graph);
	});

	test("sizes nodes by their edges once friends are merged", async () => {
		serve((url) =>
			url.startsWith(FRIEND)
				? friendFile({
						edges: [
							{ source: "/", target: "/blog/", type: "internal" },
							{ source: "/", target: LOCAL, type: "friend" },
							{ source: "/blog/", target: LOCAL, type: "friend" },
						],
					})
				: makeFile({
						friends: [FRIEND],
						nodes: [
							{ url: "/", title: "Home" },
							{ url: "/about/", title: "About" },
						],
						edges: [{ source: "/", target: "/about/", type: "internal" }],
					}),
		);

		const element = mount();
		await element.ready;

		expect(element.graph!.getNodeAttribute(LOCAL, "size")).toBe(DEFAULT_CONFIG.nodeSize * 2);
		expect(element.graph!.getNodeAttribute(`${LOCAL}about/`, "size")).toBe(DEFAULT_CONFIG.nodeSize);
	});

	test.each([
		["is missing", async () => ({ ok: false, status: 404, statusText: "Not Found" }) as Response],
		["is not a GraphGarden file", async () => ({ ok: true, json: async () => ({}) }) as Response],
	])("logs an error and renders nothing when the file %s", async (_label, fetchImpl) => {
		vi.stubGlobal("fetch", vi.fn(fetchImpl));
		const error = vi.spyOn(console, "error").mockImplementation(() => {});

		const element = mount();
		await element.ready;

		expect(error).toHaveBeenCalled();
		expect(element.graph).toBeNull();
		expect(renderers).toHaveLength(0);
	});

	test("cancels its load when removed", async () => {
		const response = deferred<Response>();
		const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => response.promise);
		vi.stubGlobal("fetch", fetchMock);
		const error = vi.spyOn(console, "error").mockImplementation(() => {});

		const element = mount();
		element.remove();
		response.resolve({ ok: true, json: async () => makeFile() } as Response);
		await element.ready;

		expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
		expect(element.graph).toBeNull();
		expect(renderers).toHaveLength(0);
		expect(error).not.toHaveBeenCalled();
	});

	test("renders once when re-attached during a load", async () => {
		const first = deferred<Response>();
		const second = deferred<Response>();
		vi.stubGlobal(
			"fetch",
			vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise),
		);

		const element = mount();
		element.remove();
		document.body.appendChild(element);
		first.resolve({ ok: true, json: async () => makeFile() } as Response);
		second.resolve({
			ok: true,
			json: async () => makeFile({ nodes: [{ url: "/second", title: "Second" }] }),
		} as Response);
		await element.ready;

		expect(element.shadowRoot!.querySelectorAll("style")).toHaveLength(1);
		expect(element.shadowRoot!.querySelectorAll("div")).toHaveLength(1);
		expect(element.graph!.nodes()).toEqual([`${LOCAL}second`]);
		expect(renderers).toHaveLength(1);
	});

	test("kills its renderer and empties its shadow root when removed", async () => {
		serve(() => makeFile());
		const element = mount();
		await element.ready;

		element.remove();

		expect(renderers[0].killed).toBe(true);
		expect(element.renderer).toBeNull();
		expect(element.graph).toBeNull();
		expect(element.shadowRoot!.childNodes).toHaveLength(0);
	});

	test("navigates on click only to http and https URLs", async () => {
		serve(() => makeFile());
		const element = mount();
		await element.ready;
		const visited: string[] = [];
		vi.stubGlobal("location", {
			set href(url: string) {
				visited.push(url);
			},
		});

		const click = renderers[0].handlers.get("clickNode")!;
		click({ node: "javascript:alert(1)" });
		click({ node: LOCAL });

		expect(visited).toEqual([LOCAL]);
	});

	test("reads its sizes from attributes and its colours from CSS custom properties", async () => {
		serve(() => makeFile({ edges: [{ source: "/", target: FRIEND, type: "friend" }] }));
		const element = mount((garden) => {
			garden.setAttribute("node-size", "7");
			garden.setAttribute("edge-size", "not-a-number");
			garden.setAttribute("label-size", "14");
			garden.style.setProperty("--gg-local-node-color", "#ff0000");
			garden.style.setProperty("--gg-frontier-edge-color", "#0000ff");
			garden.style.setProperty("--gg-label-color", "#00ff00");
		});
		await element.ready;

		// Both nodes share the only edge, so both keep the base size
		expect(element.graph!.getNodeAttributes(LOCAL)).toMatchObject({ size: 7, color: "#ff0000" });
		expect(element.graph!.getEdgeAttributes(element.graph!.edges()[0])).toMatchObject({
			size: DEFAULT_CONFIG.edgeSize,
			color: "#0000ff",
		});
		expect(renderers[0].settings).toMatchObject({
			labelSize: 14,
			labelColor: { color: "#00ff00" },
		});
	});
});

describe("<graph-garden> labels and hover", () => {
	async function render(configure: (element: GraphGarden) => void = () => {}) {
		serve(() =>
			makeFile({
				nodes: [
					{ url: "/", title: "Home" },
					{ url: "/about/", title: "About" },
					{ url: "/blog/", title: "Blog" },
				],
				edges: [
					{ source: "/", target: "/about/", type: "internal" },
					{ source: "/", target: FRIEND, type: "friend" },
					{ source: "/", target: "https://charlie.test/", type: "friend" },
					{ source: "/blog/", target: "/about/", type: "internal" },
				],
			}),
		);
		const element = mount(configure);
		await element.ready;
		// Far apart, so no label hides another unless a test moves a node
		place(element.graph!, {
			[LOCAL]: [100, 100],
			[`${LOCAL}about/`]: [400, 100],
			[`${LOCAL}blog/`]: [100, 400],
			[FRIEND]: [400, 400],
			"https://charlie.test/": [700, 400],
		});
		const renderer = renderers[0];
		renderer.render();
		return { element, renderer, settings: { ...DEFAULT_SETTINGS, ...renderer.settings } };
	}

	test("writes labels centred under their node, in the element's font, over a halo", async () => {
		const { settings } = await render((garden) => {
			garden.style.fontFamily = "Georgia";
			garden.style.setProperty("--gg-label-halo-color", "#101010");
		});
		const { context, texts, halos } = recordingContext();

		settings.defaultDrawNodeLabel(
			context,
			labelData(`${LOCAL}about/`, "About", "medium"),
			settings,
		);

		expect(texts).toEqual([
			{
				text: "About",
				x: 100,
				y: 60,
				font: "400 12px Georgia",
				letterSpacing: "0px",
				textAlign: "center",
				textBaseline: "top",
				ink: DEFAULT_CONFIG.labelColor,
				alpha: 1,
			},
		]);
		expect(halos).toEqual([{ text: "About", color: "#101010" }]);
	});

	test("sets large labels in capitals and small ones in a lighter italic", async () => {
		const { renderer, settings } = await render();
		const { context, texts } = recordingContext();
		// Close enough for small nodes to earn a label
		renderer.zoom(0.25);

		settings.defaultDrawNodeLabel(context, labelData(LOCAL, "Home", "large"), settings);
		settings.defaultDrawNodeLabel(context, labelData(`${LOCAL}blog/`, "Blog", "small"), settings);

		expect(texts[0]).toMatchObject({ text: "HOME", alpha: 1 });
		expect(texts[1]).toMatchObject({ text: "Blog", alpha: 0.7 });
		expect(texts[1].font).toMatch(/^italic /);
	});

	test("sets large labels as heavier, smaller and letter-spaced capitals than medium ones", async () => {
		const { settings } = await render();
		const { context, texts } = recordingContext();

		settings.defaultDrawNodeLabel(context, labelData(LOCAL, "Home", "large"), settings);
		settings.defaultDrawNodeLabel(context, labelData(`${LOCAL}about/`, "Home", "medium"), settings);

		const [large, medium] = texts.map(({ font, letterSpacing }) => ({
			weight: Number(/^(?:italic )?(\d+) /.exec(font)![1]),
			size: parseFloat(/ ([\d.]+)px /.exec(font)![1]),
			tracking: parseFloat(letterSpacing),
		}));
		expect(large.weight).toBeGreaterThan(medium.weight);
		expect(large.size).toBeLessThan(medium.size);
		expect(large.tracking).toBeGreaterThan(0);
		expect(medium.tracking).toBe(0);
	});

	test.each(["large", "medium", "small"])(
		"writes a hovered %s node's full title in its label's type, in full ink",
		async (tier) => {
			const { renderer, settings } = await render();
			const idle = recordingContext();
			const hover = recordingContext();
			const data = labelData(`${LOCAL}about/`, "About", tier);
			settings.defaultDrawNodeLabel(idle.context, data, settings);
			renderer.handlers.get("enterNode")!({ node: data.key, event: pointer("mousemove") });

			settings.defaultDrawNodeHover(
				hover.context,
				{ ...data, title: "About this garden" },
				settings,
			);

			const title = tier === "large" ? "ABOUT THIS GARDEN" : "About this garden";
			expect(hover.texts[0]).toEqual({ ...idle.texts[0], text: title, alpha: 1 });
		},
	);

	test("leaves a hovered node's label to the hover layer", async () => {
		const { renderer, settings } = await render();
		expect(drawnLabels(settings)).toContain(LOCAL);

		renderer.handlers.get("enterNode")!({ node: LOCAL, event: pointer("mousemove") });

		expect(drawnLabels(settings)).not.toContain(LOCAL);
	});

	test("draws no label for a node without a title", async () => {
		const { settings } = await render();
		const { context, texts } = recordingContext();

		settings.defaultDrawNodeLabel(context, labelData(FRIEND, null, "small"), settings);

		expect(texts).toEqual([]);
	});

	test.each([
		[
			"a local page with its path",
			`${LOCAL}about/?page=2`,
			"About",
			"small",
			["About", "/about/?page=2"],
		],
		["a page with its path decoded", `${LOCAL}caf%C3%A9/`, "Café", "small", ["Café", "/café/"]],
		[
			"a page with a malformed path as written",
			`${LOCAL}100%/`,
			"Full",
			"small",
			["Full", "/100%/"],
		],
		[
			"a friend page with its host and path",
			`${FRIEND}blog/`,
			"Blog",
			"small",
			["Blog", "friend.test/blog/"],
		],
		[
			"a page without a title with its address alone",
			"https://charlie.test/",
			null,
			"small",
			["charlie.test"],
		],
		[
			"a large page without a title in its own letter case",
			`${FRIEND}Blog/Post`,
			null,
			"large",
			["friend.test/Blog/Post"],
		],
	])("rings a hovered node and names %s", async (_label, key, label, tier, expected) => {
		const { element, renderer, settings } = await render();
		const { context, texts, rings } = recordingContext();
		element.graph!.mergeNode(key);
		renderer.handlers.get("enterNode")!({ node: key, event: pointer("mousemove") });

		settings.defaultDrawNodeHover(context, labelData(key, label, tier), settings);

		expect(rings).toEqual([{ radius: 9, color: "#ff0000" }]);
		expect(texts.map(({ text }) => text)).toEqual(expected);
		expect(texts[0].alpha).toBe(1);
	});

	test("draws no hover once the pointer has left the node", async () => {
		const { renderer, settings } = await render();
		const { context, texts, rings } = recordingContext();
		renderer.handlers.get("enterNode")!({ node: LOCAL, event: pointer("mousemove") });
		renderer.handlers.get("leaveNode")!({ node: LOCAL, event: pointer("mousemove") });

		settings.defaultDrawNodeHover(context, labelData(LOCAL, "Home", "large"), settings);

		expect(rings).toEqual([]);
		expect(texts).toEqual([]);
	});

	test("labels large nodes at any zoom, and the others once drawn big enough", async () => {
		const { renderer, settings } = await render();
		const about = `${LOCAL}about/`;
		const blog = `${LOCAL}blog/`;

		expect(drawnLabels(settings)).toEqual([LOCAL, about]);

		renderer.zoom(0.25);
		expect(drawnLabels(settings)).toEqual([LOCAL, about, blog]);

		// Zoomed out, nodes shrink with the map
		renderer.zoom(1.5);
		expect(drawnLabels(settings)).toEqual([LOCAL]);
	});

	test("shrinks nodes with the map when zoomed out, down to two thirds", async () => {
		const { settings } = await render();

		expect(settings.zoomToSizeRatioFunction(1.5)).toBe(1.5);
		expect(settings.zoomToSizeRatioFunction(0.25)).toBe(0.5);
		expect(settings.maxCameraRatio).toBe(1.5);
	});

	test("hides a label that would overlap a better connected node's", async () => {
		const leaf = `${LOCAL}a-leaf/`;
		const hub = `${LOCAL}z-hub/`;
		// The leaf comes first in the file and by key, so only its fewer links can cost it the label
		serve(() =>
			makeFile({
				nodes: [
					{ url: "/", title: "Home" },
					{ url: "/a-leaf/", title: "Leaf" },
					{ url: "/z-hub/", title: "Hub" },
				],
				edges: [
					{ source: "/", target: "/z-hub/", type: "internal" },
					{ source: "/z-hub/", target: "/a-leaf/", type: "internal" },
					{ source: "/z-hub/", target: FRIEND, type: "friend" },
				],
			}),
		);
		const element = mount();
		await element.ready;
		const renderer = renderers[0];
		const settings = { ...DEFAULT_SETTINGS, ...renderer.settings };
		// Close enough for the leaf to earn a label
		renderer.zoom(0.25);
		place(element.graph!, {
			[LOCAL]: [100, 100],
			[leaf]: [400, 100],
			[hub]: [400, 400],
			[FRIEND]: [700, 400],
		});
		expect(drawnLabels(settings)).toEqual([LOCAL, leaf, hub]);

		place(element.graph!, { [hub]: [400, 110] });

		expect(drawnLabels(settings)).toEqual([LOCAL, hub]);
	});

	test("gives no room to the label of a node too far off the view for Sigma to draw", async () => {
		const { element, renderer, settings } = await render();
		const blog = `${LOCAL}blog/`;
		// So close that Home's label hangs into the view while its centre lies above it
		renderer.zoom(0.01);
		place(element.graph!, { [LOCAL]: [400, -80], [blog]: [400, -39] });

		expect(drawnLabels(settings)).toEqual([`${LOCAL}about/`, blog]);
	});

	test("gives no room to a label wholly off the view", async () => {
		const { element, settings } = await render();
		const about = `${LOCAL}about/`;
		// Home's label ends just above the view, About's hangs into it
		place(element.graph!, { [LOCAL]: [400, -31], [about]: [400, -10] });

		expect(drawnLabels(settings)).toEqual([about]);
	});

	test("hides the labels of the nodes a hovered node has no link with", async () => {
		const { renderer, settings } = await render();
		renderer.zoom(0.25);

		renderer.handlers.get("enterNode")!({ node: `${LOCAL}blog/`, event: pointer("mousemove") });

		expect(drawnLabels(settings)).toEqual([`${LOCAL}about/`]);
	});

	test("keeps a hovered node's neighbour unlabelled when the map leaves it so at rest", async () => {
		const { element, renderer, settings } = await render();
		const about = `${LOCAL}about/`;
		renderer.zoom(0.25);
		place(element.graph!, { [about]: [100, 112] });
		expect(drawnLabels(settings)).not.toContain(about);

		renderer.handlers.get("enterNode")!({ node: `${LOCAL}blog/`, event: pointer("mousemove") });

		// Home goes as no neighbour of Blog, and About, a neighbour, stays hidden as at rest
		expect(drawnLabels(settings)).toEqual([]);
	});

	test("keeps a neighbour's label clear of a hovered node's title and destination", async () => {
		const { element, renderer, settings } = await render((garden) => {
			garden.setAttribute("label-size", "20");
		});
		const about = `${LOCAL}about/`;
		place(element.graph!, { [about]: [100, 140] });
		expect(drawnLabels(settings)).toEqual([LOCAL, about]);

		renderer.handlers.get("enterNode")!({ node: LOCAL, event: pointer("mousemove") });

		expect(drawnLabels(settings)).toEqual([]);
	});

	test("has drawn its labels once ready settles", async () => {
		serve(() => makeFile());
		// Big enough for its label to show
		const element = mount((garden) => garden.setAttribute("node-size", "8"));

		await element.ready;

		// Sigma's constructor frame comes before the renderer is set, so only a later one has labels
		expect(renderers[0].frames).toEqual([[], [LOCAL]]);
	});

	test("leaves the graph as it is when a finger touches a node", async () => {
		const { element, renderer, settings } = await render();
		const blog = `${LOCAL}blog/`;

		renderer.handlers.get("enterNode")!({ node: LOCAL, event: pointer("touchstart") });

		expect(renderer.refreshes).toBe(0);
		expect(settings.nodeReducer!(blog, element.graph!.getNodeAttributes(blog)).color).toBe(
			DEFAULT_CONFIG.localNodeColor,
		);
	});

	test("leaves the graph as it is when a finger moves off a node", async () => {
		const { renderer } = await render();

		renderer.handlers.get("enterNode")!({ node: LOCAL, event: pointer("touchstart") });
		renderer.handlers.get("leaveNode")!({ node: LOCAL, event: pointer("touchmove") });

		expect(renderer.refreshes).toBe(0);
	});

	test("fades all but the hovered node's neighbours until the pointer leaves", async () => {
		const { element, renderer, settings } = await render();
		const graph = element.graph!;
		const display = (key: string) => settings.nodeReducer!(key, graph.getNodeAttributes(key));
		const edgeColor = (source: string, target: string) => {
			const edge = graph.directedEdge(source, target)!;
			return settings.edgeReducer!(edge, graph.getEdgeAttributes(edge)).color;
		};
		const blog = `${LOCAL}blog/`;
		const about = `${LOCAL}about/`;

		renderer.handlers.get("enterNode")!({ node: LOCAL, event: pointer("mousemove") });

		expect(renderer.refreshes).toBe(1);
		expect(display(LOCAL).color).toBe(DEFAULT_CONFIG.localNodeColor);
		expect(display(about).color).toBe(DEFAULT_CONFIG.localNodeColor);
		expect(display(blog).color).toBe("rgb(176,214,194)");
		expect(edgeColor(LOCAL, about)).toBe(DEFAULT_CONFIG.localEdgeColor);
		expect(edgeColor(blog, about)).toBe("rgb(204,228,215)");

		renderer.handlers.get("leaveNode")!({ node: LOCAL, event: pointer("mousemove") });

		expect(renderer.refreshes).toBe(2);
		expect(display(blog).color).toBe(DEFAULT_CONFIG.localNodeColor);
		expect(edgeColor(blog, about)).toBe(DEFAULT_CONFIG.localEdgeColor);
	});

	test("fades toward the configured halo colour", async () => {
		const { element, renderer, settings } = await render((garden) => {
			garden.style.setProperty("--gg-label-halo-color", "#0f172a");
		});
		const graph = element.graph!;
		const blog = `${LOCAL}blog/`;
		const about = `${LOCAL}about/`;
		const edge = graph.directedEdge(blog, about)!;

		renderer.handlers.get("enterNode")!({ node: LOCAL, event: pointer("mousemove") });

		expect(settings.nodeReducer!(blog, graph.getNodeAttributes(blog)).color).toBe("rgb(20,63,55)");
		expect(settings.edgeReducer!(edge, graph.getEdgeAttributes(edge)).color).toBe("rgb(48,78,77)");
	});

	test("turns a hovered friend page's site to the highlight colours", async () => {
		const other = "https://other.test/";
		const charlie = "https://charlie.test/";
		serve((url) => {
			if (url.startsWith(FRIEND)) {
				return friendFile({
					nodes: [
						{ url: "/", title: "Friend Home" },
						{ url: "/blog/", title: "Friend Blog" },
						{ url: "/notes/", title: "Friend Notes" },
					],
					edges: [
						{ source: "/blog/", target: "/", type: "internal" },
						{ source: "/blog/", target: LOCAL, type: "friend" },
						{ source: "/blog/", target: other, type: "friend" },
						{ source: "/blog/", target: charlie, type: "friend" },
						{ source: "/blog/", target: "/draft/", type: "internal" },
						{ source: "/notes/", target: "/", type: "internal" },
						{ source: "/notes/", target: "/gone/", type: "internal" },
					],
				});
			}
			if (url.startsWith(other)) return makeFile({ base_url: other, site: { title: "Other" } });
			return makeFile({
				friends: [FRIEND, other],
				nodes: [
					{ url: "/", title: "Home" },
					{ url: "/about/", title: "About" },
				],
				edges: [
					{ source: "/", target: FRIEND, type: "friend" },
					{ source: "/", target: `${FRIEND}blog/`, type: "friend" },
					{ source: "/about/", target: "/", type: "internal" },
				],
			});
		});
		const element = mount();
		await element.ready;
		const graph = element.graph!;
		const { nodeReducer, edgeReducer } = renderers[0].settings;
		const nodeColor = (key: string) => nodeReducer!(key, graph.getNodeAttributes(key)).color;
		const edgeColor = (source: string, target: string) => {
			const edge = graph.directedEdge(source, target)!;
			return edgeReducer!(edge, graph.getEdgeAttributes(edge)).color;
		};
		const blog = `${FRIEND}blog/`;
		const notes = `${FRIEND}notes/`;
		expect(edgeColor(LOCAL, blog)).toBe(DEFAULT_CONFIG.friendEdgeColor);

		renderers[0].handlers.get("enterNode")!({ node: blog, event: pointer("mousemove") });

		expect(nodeColor(blog)).toBe(DEFAULT_CONFIG.highlightNodeColor);
		expect(nodeColor(FRIEND)).toBe(DEFAULT_CONFIG.highlightNodeColor);
		expect(edgeColor(blog, FRIEND)).toBe(DEFAULT_CONFIG.highlightEdgeColor);
		expect(nodeColor(notes)).toBe("rgb(231,196,223)");
		expect(edgeColor(notes, FRIEND)).toBe("rgb(239,216,234)");
		expect(nodeColor(LOCAL)).toBe(DEFAULT_CONFIG.localNodeColor);
		expect(edgeColor(blog, LOCAL)).toBe(DEFAULT_CONFIG.localEdgeColor);
		expect(edgeColor(LOCAL, blog)).toBe(DEFAULT_CONFIG.localEdgeColor);
		expect(nodeColor(other)).toBe(DEFAULT_CONFIG.friendNodeColor);
		expect(edgeColor(blog, other)).toBe(DEFAULT_CONFIG.friendEdgeColor);
		expect(nodeColor(charlie)).toBe(DEFAULT_CONFIG.frontierNodeColor);
		expect(edgeColor(blog, charlie)).toBe(DEFAULT_CONFIG.frontierEdgeColor);
		// A page of its origin that its file does not describe is a frontier page, outside the site
		expect(nodeColor(`${FRIEND}draft/`)).toBe(DEFAULT_CONFIG.frontierNodeColor);
		expect(edgeColor(blog, `${FRIEND}draft/`)).toBe(DEFAULT_CONFIG.frontierEdgeColor);
		expect(nodeColor(`${FRIEND}gone/`)).toBe("rgb(240,241,243)");
		expect(edgeColor(notes, `${FRIEND}gone/`)).toBe("rgb(243,244,245)");
		expect(nodeColor(`${LOCAL}about/`)).toBe("rgb(221,237,229)");
		expect(edgeColor(LOCAL, FRIEND)).toBe("rgb(254,245,222)");
	});

	test("fades a page of the local origin that nothing describes like the rest of the graph", async () => {
		serve(() =>
			makeFile({
				nodes: [
					{ url: "/", title: "Home" },
					{ url: "/about/", title: "About" },
				],
				edges: [
					{ source: "/", target: "/about/", type: "internal" },
					{ source: "/about/", target: "/draft/", type: "internal" },
				],
			}),
		);
		const element = mount();
		await element.ready;
		const graph = element.graph!;
		const { nodeReducer, edgeReducer } = renderers[0].settings;
		const draft = `${LOCAL}draft/`;
		const edge = graph.directedEdge(`${LOCAL}about/`, draft)!;

		renderers[0].handlers.get("enterNode")!({ node: LOCAL, event: pointer("mousemove") });

		expect(nodeReducer!(draft, graph.getNodeAttributes(draft)).color).toBe("rgb(240,241,243)");
		expect(edgeReducer!(edge, graph.getEdgeAttributes(edge)).color).toBe("rgb(243,244,245)");
	});

	test("recolours nothing around a hovered frontier page", async () => {
		const { element, renderer, settings } = await render();
		const graph = element.graph!;
		const charlie = "https://charlie.test/";
		const blog = `${LOCAL}blog/`;
		const edge = graph.directedEdge(LOCAL, charlie)!;

		renderer.handlers.get("enterNode")!({ node: charlie, event: pointer("mousemove") });

		expect(settings.nodeReducer!(charlie, graph.getNodeAttributes(charlie)).color).toBe(
			DEFAULT_CONFIG.frontierNodeColor,
		);
		expect(settings.edgeReducer!(edge, graph.getEdgeAttributes(edge)).color).toBe(
			DEFAULT_CONFIG.frontierEdgeColor,
		);
		expect(settings.nodeReducer!(blog, graph.getNodeAttributes(blog)).color).toBe(
			"rgb(221,237,229)",
		);
	});

	test("draws home pages as rings whose hole takes the halo colour", async () => {
		const { settings } = await render((garden) => {
			garden.style.setProperty("--gg-label-halo-color", "#336699");
		});
		// Sigma instantiates programs with a WebGL context, which happy-dom lacks
		const ring = Object.create(settings.nodeProgramClasses.home.prototype) as NodeCircleProgram;

		const { FRAGMENT_SHADER_SOURCE } = ring.getDefinition();

		expect(FRAGMENT_SHADER_SOURCE).toContain("vec4(0.2000, 0.4000, 0.6000, 1.0)");
	});

	// The ring reuses the circle's vertex shader, which a Sigma update could change without a WebGL test noticing
	test("keeps the ring shader linkable with Sigma's circle vertex shader", async () => {
		const { settings } = await render();
		const ring = Object.create(settings.nodeProgramClasses.home.prototype) as NodeCircleProgram;

		const { FRAGMENT_SHADER_SOURCE, VERTEX_SHADER_SOURCE, UNIFORMS } = ring.getDefinition();

		const varyings = shaderDeclarations(FRAGMENT_SHADER_SOURCE, "varying");
		expect(varyings).toEqual(["vec4 v_color", "vec2 v_diffVector", "float v_radius"]);
		for (const varying of varyings) {
			expect(shaderDeclarations(VERTEX_SHADER_SOURCE, "varying")).toContain(varying);
		}
		for (const uniform of shaderDeclarations(FRAGMENT_SHADER_SOURCE, "uniform")) {
			expect(UNIFORMS).toContain(uniform.split(" ")[1]);
		}
	});

	describe("once a font face loads", () => {
		const fonts = new EventTarget();
		beforeEach(() => {
			Object.defineProperty(document, "fonts", { value: fonts, configurable: true });
		});
		afterEach(() => {
			Reflect.deleteProperty(document, "fonts");
		});

		test("redraws its labels", async () => {
			const { renderer } = await render();
			expect(renderer.refreshes).toBe(0);

			fonts.dispatchEvent(new Event("loadingdone"));

			expect(renderer.refreshes).toBe(1);
		});

		test("measures its labels again", async () => {
			const { element, settings } = await render();
			const about = `${LOCAL}about/`;
			// Clear of Home's label in the fallback font, not in the wider web font
			place(element.graph!, { [about]: [150, 100] });
			expect(drawnLabels(settings)).toEqual([LOCAL, about]);

			fonts.dispatchEvent(new Event("loadingdone"));

			expect(drawnLabels(settings, 12)).toEqual([LOCAL]);
		});

		test("stops listening once removed", async () => {
			const { element } = await render();
			element.remove();
			document.body.appendChild(element);
			await element.ready;

			fonts.dispatchEvent(new Event("loadingdone"));

			expect(renderers[1].refreshes).toBe(1);
		});
	});

	test.each([
		[
			"hovers again when the pointer comes back onto the node it left the canvas from",
			"mouseleave",
			true,
		],
		[
			"stays idle when the pointer comes back after leaving the node inside the canvas",
			"mousemove",
			false,
		],
	])("%s", async (_label, leave, hovered) => {
		const { element, renderer, settings } = await render();
		const blog = `${LOCAL}blog/`;
		const container = element.shadowRoot!.querySelector("div")!;

		renderer.handlers.get("enterNode")!({ node: LOCAL, event: pointer("mousemove") });
		renderer.handlers.get("leaveNode")!({ node: LOCAL, event: pointer(leave) });
		renderer.handlers.get("enterStage")!({ event: pointer("mouseenter") });

		const blogColor = settings.nodeReducer!(blog, element.graph!.getNodeAttributes(blog)).color;
		expect(blogColor).toBe(hovered ? "rgb(176,214,194)" : DEFAULT_CONFIG.localNodeColor);
		expect(container.style.cursor).toBe(hovered ? "pointer" : "default");
	});

	test.each([
		["the hovered node", null],
		["the node the pointer left the canvas from", "mouseleave"],
	])("forgets %s when removed", async (_label, leave) => {
		const { element, renderer } = await render();
		renderer.handlers.get("enterNode")!({ node: LOCAL, event: pointer("mousemove") });
		if (leave) renderer.handlers.get("leaveNode")!({ node: LOCAL, event: pointer(leave) });

		element.remove();
		document.body.appendChild(element);
		await element.ready;
		renderers[1].handlers.get("enterStage")!({ event: pointer("mouseenter") });

		const settings = renderers[1].settings;
		const blog = `${LOCAL}blog/`;
		expect(settings.nodeReducer!(blog, element.graph!.getNodeAttributes(blog)).color).toBe(
			DEFAULT_CONFIG.localNodeColor,
		);
	});
});
