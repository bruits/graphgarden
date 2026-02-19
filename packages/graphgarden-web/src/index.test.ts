import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isGraphGardenFile, buildGraph, GraphGardenFile } from "./index.js";

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
		expect(graph.getNodeAttributes("/page")).toHaveProperty("title", "Page");
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
		expect(graph.hasNode("https://friend.com")).toBe(true);
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
