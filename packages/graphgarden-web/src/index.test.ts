import { describe, test, expect, vi, afterEach } from "vitest";
import Graph from "graphology";
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
		constructor(
			readonly graph: Graph,
			_container: HTMLElement,
			readonly settings: Partial<Settings>,
		) {
			created.push(this);
		}
		on(event: string, handler: (payload: SigmaPayload) => void) {
			this.handlers.set(event, handler);
			return this;
		}
		refresh() {
			this.refreshes++;
		}
		kill() {
			this.killed = true;
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
function recordingContext() {
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
	return { key, label, tier, x: 100, y: 50, size: 6, color: "#6366f1" };
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

	test("colours edges and targets by origin", () => {
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
		expect(edgeColor(FRIEND)).toBe(DEFAULT_CONFIG.friendEdgeColor);
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

	test("colours a friend's links to other sites without recolouring local pages", async () => {
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

		expect(graph.getNodeAttribute(charlie, "color")).toBe(DEFAULT_CONFIG.friendNodeColor);
		expect(graph.getNodeAttribute(LOCAL, "color")).toBe(DEFAULT_CONFIG.localNodeColor);
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
			garden.style.setProperty("--gg-label-color", "#00ff00");
		});
		await element.ready;

		// Both nodes share the only edge, so both keep the base size
		expect(element.graph!.getNodeAttributes(LOCAL)).toMatchObject({ size: 7, color: "#ff0000" });
		expect(element.graph!.getEdgeAttribute(element.graph!.edges()[0], "size")).toBe(
			DEFAULT_CONFIG.edgeSize,
		);
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
		const renderer = renderers[0];
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
		const { settings } = await render();
		const { context, texts } = recordingContext();

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
		"redraws a hovered %s label over the idle one in full ink",
		async (tier) => {
			const { renderer, settings } = await render();
			const idle = recordingContext();
			const hover = recordingContext();
			const data = labelData(`${LOCAL}about/`, "About", tier);
			renderer.handlers.get("enterNode")!({ node: data.key, event: pointer("mousemove") });

			settings.defaultDrawNodeLabel(idle.context, data, settings);
			settings.defaultDrawNodeHover(hover.context, data, settings);

			expect(hover.texts[0]).toEqual({ ...idle.texts[0], alpha: 1 });
		},
	);

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

		expect(rings).toEqual([{ radius: 9, color: "#6366f1" }]);
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

	test("always labels large nodes", async () => {
		const { element, settings } = await render();
		const graph = element.graph!;
		const forceLabel = (key: string) =>
			settings.nodeReducer!(key, graph.getNodeAttributes(key)).forceLabel;

		expect(graph.getNodeAttribute(LOCAL, "tier")).toBe("large");
		expect(forceLabel(LOCAL)).toBe(true);
		expect(forceLabel(`${LOCAL}blog/`)).toBe(false);
	});

	test("leaves the graph as it is when a finger touches a node", async () => {
		const { element, renderer, settings } = await render();
		const blog = `${LOCAL}blog/`;

		renderer.handlers.get("enterNode")!({ node: LOCAL, event: pointer("touchstart") });

		expect(renderer.refreshes).toBe(0);
		expect(settings.nodeReducer!(blog, element.graph!.getNodeAttributes(blog)).label).toBe("Blog");
	});

	test("leaves the graph as it is when a finger moves off a node", async () => {
		const { renderer } = await render();

		renderer.handlers.get("enterNode")!({ node: LOCAL, event: pointer("touchstart") });
		renderer.handlers.get("leaveNode")!({ node: LOCAL, event: pointer("touchmove") });

		expect(renderer.refreshes).toBe(0);
	});

	test("forces the labels of the 15 best connected nodes, at rest and around a hovered node", async () => {
		// Home links to twenty hubs, hub i having i + 2 leaves, so the hubs differ in degree.
		// Every page also links to an untitled friend, the best connected node of all.
		const nodes: GraphGardenFile["nodes"] = [{ url: "/", title: "Home" }];
		const edges: GraphGardenFile["edges"] = [];
		for (let hub = 0; hub < 20; hub++) {
			nodes.push({ url: `/h${hub}/`, title: `Hub ${hub}` });
			edges.push({ source: "/", target: `/h${hub}/`, type: "internal" });
			for (let leaf = 0; leaf < hub + 2; leaf++) {
				nodes.push({ url: `/h${hub}/${leaf}/`, title: `Leaf ${leaf}` });
				edges.push({ source: `/h${hub}/`, target: `/h${hub}/${leaf}/`, type: "internal" });
			}
		}
		for (const { url } of nodes) edges.push({ source: url, target: FRIEND, type: "friend" });
		serve(() => makeFile({ nodes, edges }));
		const element = mount();
		await element.ready;
		const graph = element.graph!;
		const renderer = renderers[0];
		const hubs = Array.from({ length: 20 }, (_, hub) => `${LOCAL}h${hub}/`);
		const display = (node: string) =>
			renderer.settings.nodeReducer!(node, graph.getNodeAttributes(node));
		const forced = () => graph.filterNodes((node) => display(node).forceLabel === true);

		// Home has 21 edges and hub i has i + 4, so the best connected titled nodes are Home and hubs 6 to 19
		expect(new Set(forced())).toEqual(new Set([LOCAL, ...hubs.slice(6)]));

		renderer.handlers.get("enterNode")!({ node: LOCAL, event: pointer("mousemove") });

		// Hubs 5 to 19 are Home's 15 best connected neighbours, and hub 4 is left out of them
		expect(new Set(forced().filter((node) => node !== LOCAL))).toEqual(new Set(hubs.slice(5)));
		expect(graph.neighbors(LOCAL).map((node) => display(node).label)).not.toContain(null);
		expect(display(hubs[4])).toMatchObject({ label: "Hub 4", forceLabel: false });
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
		expect(display(LOCAL)).toMatchObject({ label: "Home", color: DEFAULT_CONFIG.localNodeColor });
		expect(display(about)).toMatchObject({
			forceLabel: true,
			color: DEFAULT_CONFIG.localNodeColor,
		});
		expect(display(blog)).toMatchObject({ label: null, color: "rgb(232,232,253)" });
		expect(edgeColor(LOCAL, about)).toBe(DEFAULT_CONFIG.localEdgeColor);
		expect(edgeColor(blog, about)).toBe("rgb(239,241,244)");

		renderer.handlers.get("leaveNode")!({ node: LOCAL, event: pointer("mousemove") });

		expect(renderer.refreshes).toBe(2);
		expect(display(blog)).toMatchObject({ label: "Blog", color: DEFAULT_CONFIG.localNodeColor });
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

		expect(settings.nodeReducer!(blog, graph.getNodeAttributes(blog)).color).toBe("rgb(28,35,72)");
		expect(settings.edgeReducer!(edge, graph.getEdgeAttributes(edge)).color).toBe("rgb(35,44,63)");
	});

	test("redraws its labels once the page fonts have loaded", async () => {
		const fonts = deferred<void>();
		Object.defineProperty(document, "fonts", {
			value: { ready: fonts.promise },
			configurable: true,
		});
		try {
			const { renderer } = await render();
			expect(renderer.refreshes).toBe(0);

			fonts.resolve();
			await fonts.promise;

			expect(renderer.refreshes).toBe(1);
		} finally {
			Reflect.deleteProperty(document, "fonts");
		}
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

		const blogLabel = settings.nodeReducer!(blog, element.graph!.getNodeAttributes(blog)).label;
		expect(blogLabel).toBe(hovered ? null : "Blog");
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
		expect(settings.nodeReducer!(blog, element.graph!.getNodeAttributes(blog)).label).toBe("Blog");
	});
});
