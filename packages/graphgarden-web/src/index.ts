import Graph from "graphology";

const WELL_KNOWN_PATH = "/.well-known/graphgarden.json";

export interface GraphGardenNode {
	url: string;
	title: string;
}

export interface GraphGardenEdge {
	source: string;
	target: string;
	type: "internal" | "friend";
}

export interface GraphGardenSite {
	title: string;
	description?: string;
	language?: string;
}

/** The top-level shape of a `graphgarden.json` file. */
export interface GraphGardenFile {
	version: string;
	generated_at: string;
	base_url: string;
	site: GraphGardenSite;
	nodes: GraphGardenNode[];
	edges: GraphGardenEdge[];
}

function isNode(v: unknown): v is GraphGardenNode {
	return (
		typeof v === "object" &&
		v !== null &&
		typeof (v as Record<string, unknown>).url === "string" &&
		typeof (v as Record<string, unknown>).title === "string"
	);
}

function isEdge(v: unknown): v is GraphGardenEdge {
	return (
		typeof v === "object" &&
		v !== null &&
		typeof (v as Record<string, unknown>).source === "string" &&
		typeof (v as Record<string, unknown>).target === "string" &&
		((v as Record<string, unknown>).type === "internal" ||
			(v as Record<string, unknown>).type === "friend")
	);
}

/** Runtime check that `value` matches the {@link GraphGardenFile} shape. */
export function isGraphGardenFile(value: unknown): value is GraphGardenFile {
	if (typeof value !== "object" || value === null) return false;
	const obj = value as Record<string, unknown>;

	if (typeof obj.version !== "string") return false;
	if (typeof obj.generated_at !== "string") return false;
	if (typeof obj.base_url !== "string") return false;

	if (typeof obj.site !== "object" || obj.site === null) return false;
	const site = obj.site as Record<string, unknown>;
	if (typeof site.title !== "string") return false;
	if (site.description !== undefined && typeof site.description !== "string") return false;
	if (site.language !== undefined && typeof site.language !== "string") return false;

	if (!Array.isArray(obj.nodes) || !obj.nodes.every(isNode)) return false;
	if (!Array.isArray(obj.edges) || !obj.edges.every(isEdge)) return false;

	return true;
}

/** Build a graphology `Graph` from a parsed {@link GraphGardenFile}. */
export function buildGraph(file: GraphGardenFile): Graph {
	const graph = new Graph();

	graph.replaceAttributes({
		base_url: file.base_url,
		site: file.site,
	});

	for (const node of file.nodes) {
		const absoluteUrl = new URL(node.url, file.base_url).href;
		graph.mergeNode(absoluteUrl, { title: node.title });
	}

	// Friend-edge targets are external URLs not present in the nodes
	// array; mergeNode ensures they exist before the edge is added.
	for (const edge of file.edges) {
		const absoluteSource = new URL(edge.source, file.base_url).href;
		const absoluteTarget = new URL(edge.target, file.base_url).href;
		graph.mergeNode(absoluteSource);
		graph.mergeNode(absoluteTarget);
		graph.mergeDirectedEdge(absoluteSource, absoluteTarget, { type: edge.type });
	}

	return graph;
}

/** Fetch friend sites' graphs and merge their nodes and edges into `graph`. */
export async function fetchFriendGraphs(graph: Graph): Promise<Graph> {
	const origins = new Set<string>();
	graph.forEachEdge((_edge, attributes, _source, target) => {
		if (attributes.type === "friend") {
			try {
				origins.add(new URL(target).origin);
			} catch {
				console.warn(`fetchFriendGraphs: invalid friend target URL: ${target}`);
			}
		}
	});

	const results = await Promise.allSettled(
		[...origins].map(async (origin) => {
			const response = await fetch(`${origin}${WELL_KNOWN_PATH}`);
			if (!response.ok) {
				console.warn(
					`fetchFriendGraphs: ${origin} responded ${response.status} ${response.statusText}`,
				);
				return null;
			}
			const data: unknown = await response.json();
			if (!isGraphGardenFile(data)) {
				console.warn(`fetchFriendGraphs: ${origin} returned an invalid GraphGarden file`);
				return null;
			}
			return data;
		}),
	);

	for (const result of results) {
		if (result.status === "rejected") {
			console.warn("fetchFriendGraphs: fetch failed:", result.reason);
			continue;
		}
		const friendFile = result.value;
		if (!friendFile) continue;

		try {
			for (const node of friendFile.nodes) {
				const absoluteUrl = new URL(node.url, friendFile.base_url).href;
				graph.mergeNode(absoluteUrl, { title: node.title });
			}

			for (const edge of friendFile.edges) {
				const absoluteSource = new URL(edge.source, friendFile.base_url).href;
				const absoluteTarget = new URL(edge.target, friendFile.base_url).href;
				graph.mergeDirectedEdge(absoluteSource, absoluteTarget, { type: edge.type });
			}
		} catch (error) {
			console.warn(
				`fetchFriendGraphs: failed to merge friend file (base_url: ${friendFile.base_url}):`,
				error,
			);
		}
	}

	return graph;
}

/**
 * `<graph-garden>` custom element — fetches the site's own
 * `graphgarden.json` and builds a local graphology `Graph`.
 */
export class GraphGarden extends HTMLElement {
	static readonly tagName = "graph-garden" as const;

	/** The local graph built from the protocol file, or `null` before loading. */
	graph: Graph | null = null;

	async connectedCallback(): Promise<void> {
		try {
			const response = await fetch(WELL_KNOWN_PATH);
			if (!response.ok) {
				console.error(
					`<graph-garden> failed to fetch ${WELL_KNOWN_PATH}: ${response.status} ${response.statusText}`,
				);
				return;
			}

			const data: unknown = await response.json();
			if (!isGraphGardenFile(data)) {
				console.error("<graph-garden> fetched file does not match the GraphGarden protocol shape");
				return;
			}

			this.graph = buildGraph(data);
			await fetchFriendGraphs(this.graph);
		} catch (error) {
			console.error("<graph-garden> error during initialization:", error);
		}
	}

	disconnectedCallback(): void {
		this.graph?.clear();
		this.graph = null;
	}
}

if (!customElements.get(GraphGarden.tagName)) {
	customElements.define(GraphGarden.tagName, GraphGarden);
}
