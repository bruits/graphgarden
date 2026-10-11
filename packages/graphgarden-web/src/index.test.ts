import { describe, test, expect, vi, afterEach } from "vitest";
import Graph from "graphology";
import {
	isGraphGardenFile,
	buildGraph,
	fetchFriendGraphs,
	assignLayout,
	type GraphGardenFile,
	GraphGarden,
	DEFAULT_CONFIG,
} from "./index.js";

// Sigma needs WebGL, which happy-dom lacks
const { renderers, FakeSigma } = vi.hoisted(() => {
	class FakeSigma {
		handlers = new Map<string, (payload: { node: string }) => void>();
		killed = false;
		constructor(
			readonly graph: Graph,
			_container: HTMLElement,
			readonly settings: Record<string, unknown>,
		) {
			renderers.push(this);
		}
		on(event: string, handler: (payload: { node: string }) => void) {
			this.handlers.set(event, handler);
			return this;
		}
		kill() {
			this.killed = true;
		}
	}
	const renderers: FakeSigma[] = [];
	return { renderers, FakeSigma };
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

		expect(graph.nodes().sort()).toEqual([FRIEND, LOCAL]);
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

describe("<graph-garden>", () => {
	function mount(configure: (element: GraphGarden) => void = () => {}): GraphGarden {
		const element = document.createElement("graph-garden") as GraphGarden;
		configure(element);
		document.body.appendChild(element);
		return element;
	}

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
		const element = mount((element) => {
			element.setAttribute("node-size", "7");
			element.setAttribute("edge-size", "not-a-number");
			element.setAttribute("label-size", "14");
			element.style.setProperty("--gg-local-node-color", "#ff0000");
			element.style.setProperty("--gg-label-color", "#00ff00");
		});
		await element.ready;

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
