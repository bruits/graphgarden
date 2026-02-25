import { describe, test, expect, vi, afterEach, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Graph from "graphology";
import {
	isGraphGardenFile,
	buildGraph,
	fetchFriendGraphs,
	assignLayout,
	GraphGardenFile,
	GraphGarden,
	DEFAULT_CONFIG,
} from "./index.js";

function validFile(): Record<string, unknown> {
	return {
		version: "0.1.0",
		generated_at: "2025-01-01T00:00:00Z",
		base_url: "https://example.com",
		site: { title: "Test Site" },
		friends: ["https://friend.com"],
		nodes: [{ url: "/page", title: "Page" }],
		edges: [{ source: "/page", target: "https://friend.com", type: "friend" }],
	};
}

describe("isGraphGardenFile", () => {
	test("valid complete file returns true", () => {
		expect(isGraphGardenFile(validFile())).toBe(true);
	});

	test("missing version returns false", () => {
		const file = validFile();
		delete file.version;
		expect(isGraphGardenFile(file)).toBe(false);
	});

	test("missing generated_at returns false", () => {
		const file = validFile();
		delete file.generated_at;
		expect(isGraphGardenFile(file)).toBe(false);
	});

	test("missing base_url returns false", () => {
		const file = validFile();
		delete file.base_url;
		expect(isGraphGardenFile(file)).toBe(false);
	});

	test("missing site returns false", () => {
		const file = validFile();
		delete file.site;
		expect(isGraphGardenFile(file)).toBe(false);
	});

	test("site missing title returns false", () => {
		const file = validFile();
		file.site = {};
		expect(isGraphGardenFile(file)).toBe(false);
	});

	test("invalid node missing url returns false", () => {
		const file = validFile();
		file.nodes = [{ title: "No URL" }];
		expect(isGraphGardenFile(file)).toBe(false);
	});

	test("invalid node missing title returns false", () => {
		const file = validFile();
		file.nodes = [{ url: "/page" }];
		expect(isGraphGardenFile(file)).toBe(false);
	});

	test("invalid edge with wrong type returns false", () => {
		const file = validFile();
		file.edges = [{ source: "/a", target: "/b", type: "unknown" }];
		expect(isGraphGardenFile(file)).toBe(false);
	});

	test("invalid edge missing source returns false", () => {
		const file = validFile();
		file.edges = [{ target: "/b", type: "friend" }];
		expect(isGraphGardenFile(file)).toBe(false);
	});

	test("empty nodes and edges arrays returns true", () => {
		const file = validFile();
		file.nodes = [];
		file.edges = [];
		expect(isGraphGardenFile(file)).toBe(true);
	});

	test("null input returns false", () => {
		expect(isGraphGardenFile(null)).toBe(false);
	});

	test("undefined input returns false", () => {
		expect(isGraphGardenFile(undefined)).toBe(false);
	});

	test("non-object input string returns false", () => {
		expect(isGraphGardenFile("hello")).toBe(false);
	});

	test("non-object input number returns false", () => {
		expect(isGraphGardenFile(42)).toBe(false);
	});

	test("optional site fields absent is still valid", () => {
		const file = validFile();
		file.site = { title: "Minimal Site" };
		expect(isGraphGardenFile(file)).toBe(true);
	});

	test("site.description is non-string returns false", () => {
		const file = validFile();
		file.site = { title: "Test", description: 42 };
		expect(isGraphGardenFile(file)).toBe(false);
	});

	test("site.language is non-string returns false", () => {
		const file = validFile();
		file.site = { title: "Test", language: true };
		expect(isGraphGardenFile(file)).toBe(false);
	});

	test("missing friends is valid", () => {
		const file = validFile();
		delete file.friends;
		expect(isGraphGardenFile(file)).toBe(true);
	});

	test("friends with non-string entry returns false", () => {
		const file = validFile();
		file.friends = ["https://valid.com", 42];
		expect(isGraphGardenFile(file)).toBe(false);
	});

	test("empty friends array returns true", () => {
		const file = validFile();
		file.friends = [];
		expect(isGraphGardenFile(file)).toBe(true);
	});
});

describe("buildGraph", () => {
	test("correct number of nodes", () => {
		const graph = buildGraph(validFile() as unknown as GraphGardenFile, DEFAULT_CONFIG);
		// 1 declared node + 1 friend-edge target auto-created
		expect(graph.order).toBe(2);
	});

	test("node attributes contain title", () => {
		const graph = buildGraph(validFile() as unknown as GraphGardenFile, DEFAULT_CONFIG);
		expect(graph.getNodeAttributes("https://example.com/page")).toHaveProperty("title", "Page");
	});

	test("correct number of edges", () => {
		const graph = buildGraph(validFile() as unknown as GraphGardenFile, DEFAULT_CONFIG);
		expect(graph.size).toBe(1);
	});

	test("edge attributes contain type", () => {
		const graph = buildGraph(validFile() as unknown as GraphGardenFile, DEFAULT_CONFIG);
		const edge = graph.edges()[0];
		expect(graph.getEdgeAttributes(edge)).toHaveProperty("type", "friend");
	});

	test("graph attributes contain base_url and site", () => {
		const graph = buildGraph(validFile() as unknown as GraphGardenFile, DEFAULT_CONFIG);
		expect(graph.getAttribute("base_url")).toBe("https://example.com");
		expect(graph.getAttribute("site")).toEqual({ title: "Test Site" });
	});

	test("friend-edge target nodes are auto-created", () => {
		const graph = buildGraph(validFile() as unknown as GraphGardenFile, DEFAULT_CONFIG);
		expect(graph.hasNode("https://friend.com/")).toBe(true);
	});

	test("internal edges get localEdgeColor", () => {
		const file: GraphGardenFile = {
			version: "0.1.0",
			generated_at: "2025-01-01T00:00:00Z",
			base_url: "https://example.com",
			site: { title: "Test" },
			friends: [],
			nodes: [
				{ url: "/a", title: "A" },
				{ url: "/b", title: "B" },
			],
			edges: [{ source: "/a", target: "/b", type: "internal" }],
		};
		const graph = buildGraph(file, DEFAULT_CONFIG);
		const edge = graph.edges()[0];
		expect(graph.getEdgeAttribute(edge, "color")).toBe(DEFAULT_CONFIG.localEdgeColor);
	});

	test("friend edges get friendEdgeColor", () => {
		const graph = buildGraph(validFile() as unknown as GraphGardenFile, DEFAULT_CONFIG);
		const edge = graph.edges()[0];
		expect(graph.getEdgeAttribute(edge, "color")).toBe(DEFAULT_CONFIG.friendEdgeColor);
	});

	test("empty file produces graph with zero nodes and edges but with attributes", () => {
		const file: GraphGardenFile = {
			version: "0.1.0",
			generated_at: "2025-01-01T00:00:00Z",
			base_url: "https://empty.com",
			site: { title: "Empty" },
			friends: [],
			nodes: [],
			edges: [],
		};
		const graph = buildGraph(file, DEFAULT_CONFIG);
		expect(graph.order).toBe(0);
		expect(graph.size).toBe(0);
		expect(graph.getAttribute("base_url")).toBe("https://empty.com");
		expect(graph.getAttribute("site")).toEqual({ title: "Empty" });
	});

	test("broken internal-edge target gets frontierNodeColor", () => {
		const file: GraphGardenFile = {
			version: "0.1.0",
			generated_at: "2025-01-01T00:00:00Z",
			base_url: "https://example.com",
			site: { title: "Test" },
			friends: [],
			nodes: [{ url: "/a", title: "A" }],
			edges: [{ source: "/a", target: "/missing", type: "internal" }],
		};
		const graph = buildGraph(file, DEFAULT_CONFIG);
		expect(graph.getNodeAttribute("https://example.com/missing", "color")).toBe(
			DEFAULT_CONFIG.frontierNodeColor,
		);
	});

	test("friend-edge target gets frontierNodeColor initially", () => {
		const graph = buildGraph(validFile() as unknown as GraphGardenFile, DEFAULT_CONFIG);
		expect(graph.getNodeAttribute("https://friend.com/", "color")).toBe(
			DEFAULT_CONFIG.frontierNodeColor,
		);
	});

	test("internal-edge target declared in nodes keeps localNodeColor", () => {
		const file: GraphGardenFile = {
			version: "0.1.0",
			generated_at: "2025-01-01T00:00:00Z",
			base_url: "https://example.com",
			site: { title: "Test" },
			friends: [],
			nodes: [
				{ url: "/a", title: "A" },
				{ url: "/b", title: "B" },
			],
			edges: [{ source: "/a", target: "/b", type: "internal" }],
		};
		const graph = buildGraph(file, DEFAULT_CONFIG);
		expect(graph.getNodeAttribute("https://example.com/b", "color")).toBe(
			DEFAULT_CONFIG.localNodeColor,
		);
	});
});

describe("buildGraph with fixture data", () => {
	const fixturePath = resolve(import.meta.dirname, "../../../fixtures/bob/graphgarden.json");
	const raw = readFileSync(fixturePath, "utf-8");
	const data: unknown = JSON.parse(raw);

	test("fixture passes isGraphGardenFile validation", () => {
		expect(isGraphGardenFile(data)).toBe(true);
	});

	test("graph has expected node count", () => {
		const graph = buildGraph(data as GraphGardenFile, DEFAULT_CONFIG);
		// Bob has 4 declared nodes + 2 external friend targets = 6 nodes
		expect(graph.order).toBe(6);
	});

	test("graph has expected edge count", () => {
		const graph = buildGraph(data as GraphGardenFile, DEFAULT_CONFIG);
		expect(graph.size).toBe(9);
	});
});

describe("fetchFriendGraphs", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	function localFileWithFriend(friendTarget = "https://friend.test/"): GraphGardenFile {
		return {
			version: "0.1.0",
			generated_at: "2025-01-01T00:00:00Z",
			base_url: "https://local.test/",
			site: { title: "Local" },
			friends: [friendTarget],
			nodes: [{ url: "/", title: "Home" }],
			edges: [{ source: "/", target: friendTarget, type: "friend" }],
		};
	}

	function friendFile(): GraphGardenFile {
		return {
			version: "0.1.0",
			generated_at: "2025-01-01T00:00:00Z",
			base_url: "https://friend.test/",
			site: { title: "Friend Site" },
			friends: [],
			nodes: [
				{ url: "/", title: "Friend Home" },
				{ url: "/blog/", title: "Friend Blog" },
			],
			edges: [{ source: "/", target: "/blog/", type: "internal" }],
		};
	}

	function stubFetchWith(response: Partial<Response>) {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({}),
				...response,
			}),
		);
	}

	test("merges friend nodes with absolute URL keys", async () => {
		const file = localFileWithFriend();
		const graph = buildGraph(file, DEFAULT_CONFIG);
		stubFetchWith({ json: () => Promise.resolve(friendFile()) });

		await fetchFriendGraphs(graph, DEFAULT_CONFIG, file.friends);

		expect(graph.hasNode("https://friend.test/")).toBe(true);
		expect(graph.getNodeAttribute("https://friend.test/", "title")).toBe("Friend Home");
		expect(graph.hasNode("https://friend.test/blog/")).toBe(true);
		expect(graph.getNodeAttribute("https://friend.test/blog/", "title")).toBe("Friend Blog");
	});

	test("merges friend edges with resolved URLs", async () => {
		const file = localFileWithFriend();
		const graph = buildGraph(file, DEFAULT_CONFIG);
		stubFetchWith({ json: () => Promise.resolve(friendFile()) });

		await fetchFriendGraphs(graph, DEFAULT_CONFIG, file.friends);

		expect(graph.hasDirectedEdge("https://friend.test/", "https://friend.test/blog/")).toBe(true);
	});

	test("deduplicates fetches for same origin", async () => {
		const file: GraphGardenFile = {
			version: "0.1.0",
			generated_at: "2025-01-01T00:00:00Z",
			base_url: "https://local.test/",
			site: { title: "Local" },
			friends: ["https://friend.test/"],
			nodes: [
				{ url: "/", title: "Home" },
				{ url: "/about/", title: "About" },
			],
			edges: [
				{ source: "/", target: "https://friend.test/", type: "friend" },
				{ source: "/about/", target: "https://friend.test/blog/", type: "friend" },
			],
		};
		const graph = buildGraph(file, DEFAULT_CONFIG);
		stubFetchWith({ json: () => Promise.resolve(friendFile()) });

		await fetchFriendGraphs(graph, DEFAULT_CONFIG, file.friends);

		expect(fetch).toHaveBeenCalledTimes(1);
		expect(fetch).toHaveBeenCalledWith("https://friend.test/.well-known/graphgarden.json");
	});

	test("handles fetch rejection gracefully", async () => {
		const file = localFileWithFriend();
		const graph = buildGraph(file, DEFAULT_CONFIG);
		const initialOrder = graph.order;
		const initialSize = graph.size;

		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));
		vi.spyOn(console, "warn").mockImplementation(() => {});

		await fetchFriendGraphs(graph, DEFAULT_CONFIG, file.friends);

		expect(graph.order).toBe(initialOrder);
		expect(graph.size).toBe(initialSize);
	});

	test("handles non-OK response gracefully", async () => {
		const file = localFileWithFriend();
		const graph = buildGraph(file, DEFAULT_CONFIG);
		const initialOrder = graph.order;

		stubFetchWith({ ok: false, status: 404, statusText: "Not Found" } as Partial<Response>);
		vi.spyOn(console, "warn").mockImplementation(() => {});

		await fetchFriendGraphs(graph, DEFAULT_CONFIG, file.friends);

		expect(graph.order).toBe(initialOrder);
	});

	test("handles invalid response shape gracefully", async () => {
		const file = localFileWithFriend();
		const graph = buildGraph(file, DEFAULT_CONFIG);
		const initialOrder = graph.order;

		stubFetchWith({ json: () => Promise.resolve({ invalid: true }) });
		vi.spyOn(console, "warn").mockImplementation(() => {});

		await fetchFriendGraphs(graph, DEFAULT_CONFIG, file.friends);

		expect(graph.order).toBe(initialOrder);
	});

	test("resolves relative paths against friend base_url", async () => {
		const localFile = localFileWithFriend();
		const graph = buildGraph(localFile, DEFAULT_CONFIG);
		const file: GraphGardenFile = {
			version: "0.1.0",
			generated_at: "2025-01-01T00:00:00Z",
			base_url: "https://friend.test/",
			site: { title: "Friend" },
			friends: [],
			nodes: [{ url: "/deep/path/", title: "Deep Page" }],
			edges: [],
		};
		stubFetchWith({ json: () => Promise.resolve(file) });

		await fetchFriendGraphs(graph, DEFAULT_CONFIG, localFile.friends);

		expect(graph.hasNode("https://friend.test/deep/path/")).toBe(true);
		expect(graph.getNodeAttribute("https://friend.test/deep/path/", "title")).toBe("Deep Page");
	});

	test("returns the mutated graph", async () => {
		const file = localFileWithFriend();
		const graph = buildGraph(file, DEFAULT_CONFIG);
		stubFetchWith({ json: () => Promise.resolve(friendFile()) });

		const result = await fetchFriendGraphs(graph, DEFAULT_CONFIG, file.friends);

		expect(result).toBe(graph);
	});

	test("friend-of-friend nodes get correct size and color", async () => {
		const localFile = localFileWithFriend();
		const graph = buildGraph(localFile, DEFAULT_CONFIG);

		// Friend file with a friend edge to an unknown third-party URL
		const file: GraphGardenFile = {
			version: "0.1.0",
			generated_at: "2025-01-01T00:00:00Z",
			base_url: "https://friend.test/",
			site: { title: "Friend" },
			friends: [],
			nodes: [{ url: "/", title: "Friend Home" }],
			edges: [{ source: "/", target: "https://charlie.test/", type: "friend" }],
		};
		stubFetchWith({ json: () => Promise.resolve(file) });

		await fetchFriendGraphs(graph, DEFAULT_CONFIG, localFile.friends);

		// Charlie was implicitly created by the friend edge
		expect(graph.hasNode("https://charlie.test/")).toBe(true);
		expect(graph.getNodeAttribute("https://charlie.test/", "size")).toBe(DEFAULT_CONFIG.nodeSize);
		expect(graph.getNodeAttribute("https://charlie.test/", "color")).toBe(
			DEFAULT_CONFIG.friendNodeColor,
		);
	});

	test("friend internal edges get friendEdgeColor, not localEdgeColor", async () => {
		const file = localFileWithFriend();
		const graph = buildGraph(file, DEFAULT_CONFIG);
		stubFetchWith({ json: () => Promise.resolve(friendFile()) });

		await fetchFriendGraphs(graph, DEFAULT_CONFIG, file.friends);

		const friendEdge = graph.directedEdge("https://friend.test/", "https://friend.test/blog/");
		expect(friendEdge).toBeDefined();
		expect(graph.getEdgeAttribute(friendEdge!, "color")).toBe(DEFAULT_CONFIG.friendEdgeColor);
	});

	test("graph with no friend edges skips fetching", async () => {
		const graph = buildGraph(
			{
				version: "0.1.0",
				generated_at: "2025-01-01T00:00:00Z",
				base_url: "https://local.test/",
				site: { title: "Local" },
				friends: [],
				nodes: [
					{ url: "/", title: "Home" },
					{ url: "/about/", title: "About" },
				],
				edges: [{ source: "/", target: "/about/", type: "internal" }],
			},
			DEFAULT_CONFIG,
		);

		const mockFetch = vi.fn();
		vi.stubGlobal("fetch", mockFetch);

		await fetchFriendGraphs(graph, DEFAULT_CONFIG, []);

		expect(mockFetch).not.toHaveBeenCalled();
	});

	test("deduplicates nodes when friend edges point back to local site", async () => {
		const localFile = localFileWithFriend();
		const graph = buildGraph(localFile, DEFAULT_CONFIG);

		// Friend file with an edge pointing back to the local site
		const file: GraphGardenFile = {
			version: "0.1.0",
			generated_at: "2025-01-01T00:00:00Z",
			base_url: "https://friend.test/",
			site: { title: "Friend" },
			friends: [],
			nodes: [{ url: "/", title: "Friend Home" }],
			edges: [{ source: "/", target: "https://local.test/", type: "friend" }],
		};
		stubFetchWith({ json: () => Promise.resolve(file) });

		await fetchFriendGraphs(graph, DEFAULT_CONFIG, localFile.friends);

		// Local "/" was resolved to "https://local.test/" by buildGraph;
		// the friend edge target is the same URL, so no duplicate is created.
		const localHomeNodes = graph.nodes().filter((n) => n === "https://local.test/");
		expect(localHomeNodes).toHaveLength(1);
		expect(graph.hasNode("/")).toBe(false);
	});

	test("skips friend file with invalid base_url without crashing", async () => {
		const localFile: GraphGardenFile = {
			version: "0.1.0",
			generated_at: "2025-01-01T00:00:00Z",
			base_url: "https://local.test/",
			site: { title: "Local" },
			friends: ["https://bad.test/", "https://good.test/"],
			nodes: [{ url: "/", title: "Home" }],
			edges: [
				{ source: "/", target: "https://bad.test/", type: "friend" },
				{ source: "/", target: "https://good.test/", type: "friend" },
			],
		};
		const graph = buildGraph(localFile, DEFAULT_CONFIG);

		const badFile: GraphGardenFile = {
			version: "0.1.0",
			generated_at: "2025-01-01T00:00:00Z",
			base_url: "",
			site: { title: "Bad" },
			friends: [],
			nodes: [{ url: "/page", title: "Page" }],
			edges: [],
		};
		const goodFile: GraphGardenFile = {
			version: "0.1.0",
			generated_at: "2025-01-01T00:00:00Z",
			base_url: "https://good.test/",
			site: { title: "Good" },
			friends: [],
			nodes: [{ url: "/", title: "Good Home" }],
			edges: [],
		};

		vi.stubGlobal(
			"fetch",
			vi.fn().mockImplementation((url: string) => {
				if (url.startsWith("https://bad.test")) {
					return Promise.resolve({
						ok: true,
						json: () => Promise.resolve(badFile),
					});
				}
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve(goodFile),
				});
			}),
		);
		vi.spyOn(console, "warn").mockImplementation(() => {});

		await fetchFriendGraphs(graph, DEFAULT_CONFIG, localFile.friends);

		expect(graph.hasNode("https://good.test/")).toBe(true);
		expect(graph.getNodeAttribute("https://good.test/", "title")).toBe("Good Home");
		expect(console.warn).toHaveBeenCalled();
	});

	test("upgrades frontier friend nodes to friendNodeColor after successful fetch", async () => {
		const file = localFileWithFriend();
		const graph = buildGraph(file, DEFAULT_CONFIG);

		expect(graph.getNodeAttribute("https://friend.test/", "color")).toBe(
			DEFAULT_CONFIG.frontierNodeColor,
		);

		stubFetchWith({ json: () => Promise.resolve(friendFile()) });
		await fetchFriendGraphs(graph, DEFAULT_CONFIG, file.friends);

		expect(graph.getNodeAttribute("https://friend.test/", "color")).toBe(
			DEFAULT_CONFIG.friendNodeColor,
		);
	});

	test("leaves frontierNodeColor on nodes when fetch fails", async () => {
		const file = localFileWithFriend();
		const graph = buildGraph(file, DEFAULT_CONFIG);

		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));
		vi.spyOn(console, "warn").mockImplementation(() => {});

		await fetchFriendGraphs(graph, DEFAULT_CONFIG, file.friends);

		expect(graph.getNodeAttribute("https://friend.test/", "color")).toBe(
			DEFAULT_CONFIG.frontierNodeColor,
		);
	});

	test("fetches declared friend with no edges pointing to it", async () => {
		const file: GraphGardenFile = {
			version: "0.1.0",
			generated_at: "2025-01-01T00:00:00Z",
			base_url: "https://local.test/",
			site: { title: "Local" },
			friends: ["https://friend.test/"],
			nodes: [{ url: "/", title: "Home" }],
			edges: [],
		};
		const graph = buildGraph(file, DEFAULT_CONFIG);
		stubFetchWith({ json: () => Promise.resolve(friendFile()) });

		await fetchFriendGraphs(graph, DEFAULT_CONFIG, file.friends);

		expect(fetch).toHaveBeenCalledTimes(1);
		expect(fetch).toHaveBeenCalledWith("https://friend.test/.well-known/graphgarden.json");
		expect(graph.hasNode("https://friend.test/")).toBe(true);
		expect(graph.getNodeAttribute("https://friend.test/", "title")).toBe("Friend Home");
	});
});

describe("assignLayout", () => {
	test("assigns x and y coordinates to all nodes", () => {
		const file: GraphGardenFile = {
			version: "0.1.0",
			generated_at: "2025-01-01T00:00:00Z",
			base_url: "https://example.com",
			site: { title: "Test" },
			friends: [],
			nodes: [
				{ url: "/a", title: "A" },
				{ url: "/b", title: "B" },
				{ url: "/c", title: "C" },
			],
			edges: [
				{ source: "/a", target: "/b", type: "internal" },
				{ source: "/b", target: "/c", type: "internal" },
			],
		};
		const graph = buildGraph(file, DEFAULT_CONFIG);

		assignLayout(graph, DEFAULT_CONFIG.iterations);

		graph.forEachNode((_node, attributes) => {
			expect(attributes.x).toBeTypeOf("number");
			expect(attributes.y).toBeTypeOf("number");
			expect(Number.isFinite(attributes.x)).toBe(true);
			expect(Number.isFinite(attributes.y)).toBe(true);
		});
	});

	test("handles empty graph without error", () => {
		const graph = new Graph();
		expect(() => assignLayout(graph, DEFAULT_CONFIG.iterations)).not.toThrow();
	});

	test("handles single-node graph", () => {
		const file: GraphGardenFile = {
			version: "0.1.0",
			generated_at: "2025-01-01T00:00:00Z",
			base_url: "https://example.com",
			site: { title: "Test" },
			friends: [],
			nodes: [{ url: "/", title: "Home" }],
			edges: [],
		};
		const graph = buildGraph(file, DEFAULT_CONFIG);

		assignLayout(graph, DEFAULT_CONFIG.iterations);

		expect(graph.getNodeAttribute("https://example.com/", "x")).toBeTypeOf("number");
		expect(graph.getNodeAttribute("https://example.com/", "y")).toBeTypeOf("number");
	});

	test("produces distinct positions for connected nodes", () => {
		const file: GraphGardenFile = {
			version: "0.1.0",
			generated_at: "2025-01-01T00:00:00Z",
			base_url: "https://example.com",
			site: { title: "Test" },
			friends: [],
			nodes: [
				{ url: "/a", title: "A" },
				{ url: "/b", title: "B" },
			],
			edges: [{ source: "/a", target: "/b", type: "internal" }],
		};
		const graph = buildGraph(file, DEFAULT_CONFIG);

		assignLayout(graph, DEFAULT_CONFIG.iterations);

		const ax = graph.getNodeAttribute("https://example.com/a", "x");
		const ay = graph.getNodeAttribute("https://example.com/a", "y");
		const bx = graph.getNodeAttribute("https://example.com/b", "x");
		const by = graph.getNodeAttribute("https://example.com/b", "y");

		// With 200 iterations of ForceAtlas2 the nodes should not remain at the exact same position
		const samePosition = ax === bx && ay === by;
		expect(samePosition).toBe(false);
	});
});

describe("GraphGarden custom element", () => {
	beforeEach(() => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("no fetch in tests")));
		vi.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		// Remove any registered elements from the DOM
		document.querySelectorAll("graph-garden").forEach((el) => el.remove());
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	test("creates a Shadow DOM with a container div when connected", () => {
		const element = document.createElement("graph-garden") as GraphGarden;
		document.body.appendChild(element);

		expect(element.shadowRoot).not.toBeNull();
		const container = element.shadowRoot!.querySelector("div");
		expect(container).not.toBeNull();
	});

	test("shadow DOM contains a style element with host display block", () => {
		const element = document.createElement("graph-garden") as GraphGarden;
		document.body.appendChild(element);

		const style = element.shadowRoot!.querySelector("style");
		expect(style).not.toBeNull();
		expect(style!.textContent).toContain(":host");
		expect(style!.textContent).toContain("display: block");
	});

	test("cleans up shadow DOM content on disconnect", async () => {
		const element = document.createElement("graph-garden") as GraphGarden;

		document.body.appendChild(element);

		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(element.shadowRoot!.querySelector("div")).not.toBeNull();

		element.remove();

		expect(element.shadowRoot!.innerHTML).toBe("");
		expect(element.graph).toBeNull();
		expect(element.renderer).toBeNull();
	});

	test("graph edges have types registered as Sigma programs", async () => {
		const file = validFile();
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve(file),
			}),
		);
		vi.spyOn(console, "warn").mockImplementation(() => {});

		const element = document.createElement("graph-garden") as GraphGarden;
		document.body.appendChild(element);
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(element.graph).not.toBeNull();

		// Every edge type must be one we register in edgeProgramClasses
		const registeredTypes = new Set(["internal", "friend"]);
		element.graph!.forEachEdge((_edge, attrs) => {
			expect(registeredTypes.has(attrs.type)).toBe(true);
		});

		element.remove();
	});

	test("successful fetch populates graph with layout coordinates", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve(validFile()),
			}),
		);
		vi.spyOn(console, "warn").mockImplementation(() => {});

		const element = document.createElement("graph-garden") as GraphGarden;
		document.body.appendChild(element);
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(element.graph).not.toBeNull();
		expect(element.graph!.order).toBeGreaterThan(0);
		element.graph!.forEachNode((_node, attrs) => {
			expect(attrs.x).toBeTypeOf("number");
			expect(attrs.y).toBeTypeOf("number");
		});

		element.remove();
	});
});

describe("customization", () => {
	test("buildGraph applies custom colors to nodes", () => {
		const config = { ...DEFAULT_CONFIG, localNodeColor: "#ff0000" };
		const graph = buildGraph(validFile() as unknown as GraphGardenFile, config);
		expect(graph.getNodeAttribute("https://example.com/page", "color")).toBe("#ff0000");
	});

	test("buildGraph applies custom node size", () => {
		const config = { ...DEFAULT_CONFIG, nodeSize: 10 };
		const graph = buildGraph(validFile() as unknown as GraphGardenFile, config);
		expect(graph.getNodeAttribute("https://example.com/page", "size")).toBe(10);
	});

	test("buildGraph applies custom edge size", () => {
		const config = { ...DEFAULT_CONFIG, edgeSize: 2 };
		const graph = buildGraph(validFile() as unknown as GraphGardenFile, config);
		const edge = graph.edges()[0];
		expect(graph.getEdgeAttribute(edge, "size")).toBe(2);
	});

	test("DEFAULT_CONFIG.frontierNodeColor has expected default value", () => {
		expect(DEFAULT_CONFIG.frontierNodeColor).toBe("#9ca3af");
	});

	test("buildGraph applies custom frontierNodeColor to undeclared edge targets", () => {
		const config = { ...DEFAULT_CONFIG, frontierNodeColor: "#aabbcc" };
		const graph = buildGraph(validFile() as unknown as GraphGardenFile, config);
		expect(graph.getNodeAttribute("https://friend.com/", "color")).toBe("#aabbcc");
	});

	test("assignLayout respects custom iterations", () => {
		const file: GraphGardenFile = {
			version: "0.1.0",
			generated_at: "2025-01-01T00:00:00Z",
			base_url: "https://example.com",
			site: { title: "Test" },
			friends: [],
			nodes: [
				{ url: "/a", title: "A" },
				{ url: "/b", title: "B" },
			],
			edges: [{ source: "/a", target: "/b", type: "internal" }],
		};
		const graph = buildGraph(file, DEFAULT_CONFIG);
		// With just 1 iteration, layout should still assign coordinates
		assignLayout(graph, 1);
		expect(graph.getNodeAttribute("https://example.com/a", "x")).toBeTypeOf("number");
	});

	test("invalid attribute values fall back to defaults", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve(validFile()),
			}),
		);
		vi.spyOn(console, "warn").mockImplementation(() => {});

		const element = document.createElement("graph-garden") as GraphGarden;
		element.setAttribute("node-size", "not-a-number");
		element.setAttribute("iterations", "-5");
		element.setAttribute("edge-size", "0");
		document.body.appendChild(element);
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(element.graph).not.toBeNull();
		element.graph!.forEachNode((_node, attrs) => {
			expect(attrs.size).toBe(DEFAULT_CONFIG.nodeSize);
		});
		element.graph!.forEachEdge((_edge, attrs) => {
			expect(attrs.size).toBe(DEFAULT_CONFIG.edgeSize);
		});

		element.remove();
	});
});
