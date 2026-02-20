import { describe, test, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isGraphGardenFile, buildGraph, fetchFriendGraphs, GraphGardenFile } from "./index.js";

function validFile(): Record<string, unknown> {
	return {
		version: "0.1.0",
		generated_at: "2025-01-01T00:00:00Z",
		base_url: "https://example.com",
		site: { title: "Test Site" },
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
});

describe("buildGraph", () => {
	test("correct number of nodes", () => {
		const graph = buildGraph(validFile() as unknown as GraphGardenFile);
		// 1 declared node + 1 friend-edge target auto-created
		expect(graph.order).toBe(2);
	});

	test("node attributes contain title", () => {
		const graph = buildGraph(validFile() as unknown as GraphGardenFile);
		expect(graph.getNodeAttributes("https://example.com/page")).toHaveProperty("title", "Page");
	});

	test("correct number of edges", () => {
		const graph = buildGraph(validFile() as unknown as GraphGardenFile);
		expect(graph.size).toBe(1);
	});

	test("edge attributes contain type", () => {
		const graph = buildGraph(validFile() as unknown as GraphGardenFile);
		const edge = graph.edges()[0];
		expect(graph.getEdgeAttributes(edge)).toHaveProperty("type", "friend");
	});

	test("graph attributes contain base_url and site", () => {
		const graph = buildGraph(validFile() as unknown as GraphGardenFile);
		expect(graph.getAttribute("base_url")).toBe("https://example.com");
		expect(graph.getAttribute("site")).toEqual({ title: "Test Site" });
	});

	test("friend-edge target nodes are auto-created", () => {
		const graph = buildGraph(validFile() as unknown as GraphGardenFile);
		expect(graph.hasNode("https://friend.com/")).toBe(true);
	});

	test("empty file produces graph with zero nodes and edges but with attributes", () => {
		const file: GraphGardenFile = {
			version: "0.1.0",
			generated_at: "2025-01-01T00:00:00Z",
			base_url: "https://empty.com",
			site: { title: "Empty" },
			nodes: [],
			edges: [],
		};
		const graph = buildGraph(file);
		expect(graph.order).toBe(0);
		expect(graph.size).toBe(0);
		expect(graph.getAttribute("base_url")).toBe("https://empty.com");
		expect(graph.getAttribute("site")).toEqual({ title: "Empty" });
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
		const graph = buildGraph(data as GraphGardenFile);
		// Bob has 4 declared nodes + 2 external friend targets = 6 nodes
		expect(graph.order).toBe(6);
	});

	test("graph has expected edge count", () => {
		const graph = buildGraph(data as GraphGardenFile);
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
		const graph = buildGraph(localFileWithFriend());
		stubFetchWith({ json: () => Promise.resolve(friendFile()) });

		await fetchFriendGraphs(graph);

		expect(graph.hasNode("https://friend.test/")).toBe(true);
		expect(graph.getNodeAttribute("https://friend.test/", "title")).toBe("Friend Home");
		expect(graph.hasNode("https://friend.test/blog/")).toBe(true);
		expect(graph.getNodeAttribute("https://friend.test/blog/", "title")).toBe("Friend Blog");
	});

	test("merges friend edges with resolved URLs", async () => {
		const graph = buildGraph(localFileWithFriend());
		stubFetchWith({ json: () => Promise.resolve(friendFile()) });

		await fetchFriendGraphs(graph);

		expect(graph.hasDirectedEdge("https://friend.test/", "https://friend.test/blog/")).toBe(true);
	});

	test("deduplicates fetches for same origin", async () => {
		const file: GraphGardenFile = {
			version: "0.1.0",
			generated_at: "2025-01-01T00:00:00Z",
			base_url: "https://local.test/",
			site: { title: "Local" },
			nodes: [
				{ url: "/", title: "Home" },
				{ url: "/about/", title: "About" },
			],
			edges: [
				{ source: "/", target: "https://friend.test/", type: "friend" },
				{ source: "/about/", target: "https://friend.test/blog/", type: "friend" },
			],
		};
		const graph = buildGraph(file);
		stubFetchWith({ json: () => Promise.resolve(friendFile()) });

		await fetchFriendGraphs(graph);

		expect(fetch).toHaveBeenCalledTimes(1);
		expect(fetch).toHaveBeenCalledWith("https://friend.test/.well-known/graphgarden.json");
	});

	test("handles fetch rejection gracefully", async () => {
		const graph = buildGraph(localFileWithFriend());
		const initialOrder = graph.order;
		const initialSize = graph.size;

		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));
		vi.spyOn(console, "warn").mockImplementation(() => {});

		await fetchFriendGraphs(graph);

		expect(graph.order).toBe(initialOrder);
		expect(graph.size).toBe(initialSize);
	});

	test("handles non-OK response gracefully", async () => {
		const graph = buildGraph(localFileWithFriend());
		const initialOrder = graph.order;

		stubFetchWith({ ok: false, status: 404, statusText: "Not Found" } as Partial<Response>);
		vi.spyOn(console, "warn").mockImplementation(() => {});

		await fetchFriendGraphs(graph);

		expect(graph.order).toBe(initialOrder);
	});

	test("handles invalid response shape gracefully", async () => {
		const graph = buildGraph(localFileWithFriend());
		const initialOrder = graph.order;

		stubFetchWith({ json: () => Promise.resolve({ invalid: true }) });
		vi.spyOn(console, "warn").mockImplementation(() => {});

		await fetchFriendGraphs(graph);

		expect(graph.order).toBe(initialOrder);
	});

	test("resolves relative paths against friend base_url", async () => {
		const graph = buildGraph(localFileWithFriend());
		const file: GraphGardenFile = {
			version: "0.1.0",
			generated_at: "2025-01-01T00:00:00Z",
			base_url: "https://friend.test/",
			site: { title: "Friend" },
			nodes: [{ url: "/deep/path/", title: "Deep Page" }],
			edges: [],
		};
		stubFetchWith({ json: () => Promise.resolve(file) });

		await fetchFriendGraphs(graph);

		expect(graph.hasNode("https://friend.test/deep/path/")).toBe(true);
		expect(graph.getNodeAttribute("https://friend.test/deep/path/", "title")).toBe("Deep Page");
	});

	test("returns the mutated graph", async () => {
		const graph = buildGraph(localFileWithFriend());
		stubFetchWith({ json: () => Promise.resolve(friendFile()) });

		const result = await fetchFriendGraphs(graph);

		expect(result).toBe(graph);
	});

	test("graph with no friend edges skips fetching", async () => {
		const graph = buildGraph({
			version: "0.1.0",
			generated_at: "2025-01-01T00:00:00Z",
			base_url: "https://local.test/",
			site: { title: "Local" },
			nodes: [
				{ url: "/", title: "Home" },
				{ url: "/about/", title: "About" },
			],
			edges: [{ source: "/", target: "/about/", type: "internal" }],
		});

		const mockFetch = vi.fn();
		vi.stubGlobal("fetch", mockFetch);

		await fetchFriendGraphs(graph);

		expect(mockFetch).not.toHaveBeenCalled();
	});

	test("deduplicates nodes when friend edges point back to local site", async () => {
		const graph = buildGraph(localFileWithFriend());

		// Friend file with an edge pointing back to the local site
		const file: GraphGardenFile = {
			version: "0.1.0",
			generated_at: "2025-01-01T00:00:00Z",
			base_url: "https://friend.test/",
			site: { title: "Friend" },
			nodes: [{ url: "/", title: "Friend Home" }],
			edges: [{ source: "/", target: "https://local.test/", type: "friend" }],
		};
		stubFetchWith({ json: () => Promise.resolve(file) });

		await fetchFriendGraphs(graph);

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
			nodes: [{ url: "/", title: "Home" }],
			edges: [
				{ source: "/", target: "https://bad.test/", type: "friend" },
				{ source: "/", target: "https://good.test/", type: "friend" },
			],
		};
		const graph = buildGraph(localFile);

		const badFile: GraphGardenFile = {
			version: "0.1.0",
			generated_at: "2025-01-01T00:00:00Z",
			base_url: "",
			site: { title: "Bad" },
			nodes: [{ url: "/page", title: "Page" }],
			edges: [],
		};
		const goodFile: GraphGardenFile = {
			version: "0.1.0",
			generated_at: "2025-01-01T00:00:00Z",
			base_url: "https://good.test/",
			site: { title: "Good" },
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

		await fetchFriendGraphs(graph);

		expect(graph.hasNode("https://good.test/")).toBe(true);
		expect(graph.getNodeAttribute("https://good.test/", "title")).toBe("Good Home");
		expect(console.warn).toHaveBeenCalled();
	});
});
