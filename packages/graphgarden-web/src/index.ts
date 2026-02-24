import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import Sigma from "sigma";
import { EdgeRectangleProgram } from "sigma/rendering";

const WELL_KNOWN_PATH = "/.well-known/graphgarden.json";

export interface GraphGardenConfig {
	localNodeColor: string;
	friendNodeColor: string;
	localEdgeColor: string;
	friendEdgeColor: string;
	labelColor: string;
	nodeSize: number;
	edgeSize: number;
	labelSize: number;
	iterations: number;
}

export const DEFAULT_CONFIG: GraphGardenConfig = {
	localNodeColor: "#6366f1",
	friendNodeColor: "#f59e0b",
	localEdgeColor: "#94a3b8",
	friendEdgeColor: "#fbbf24",
	labelColor: "#334155",
	nodeSize: 4,
	edgeSize: 0.5,
	labelSize: 12,
	iterations: 200,
};

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
	friends: string[];
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

	if (!Array.isArray(obj.friends) || !obj.friends.every((f: unknown) => typeof f === "string"))
		return false;

	if (!Array.isArray(obj.nodes) || !obj.nodes.every(isNode)) return false;
	if (!Array.isArray(obj.edges) || !obj.edges.every(isEdge)) return false;

	return true;
}

/** Build a graphology `Graph` from a parsed {@link GraphGardenFile}. */
export function buildGraph(file: GraphGardenFile, config: GraphGardenConfig): Graph {
	const graph = new Graph();

	graph.replaceAttributes({
		base_url: file.base_url,
		site: file.site,
	});

	for (const node of file.nodes) {
		const absoluteUrl = new URL(node.url, file.base_url).href;
		graph.mergeNode(absoluteUrl, {
			title: node.title,
			label: node.title,
			size: config.nodeSize,
			color: config.localNodeColor,
		});
	}

	// Friend-edge targets are external URLs not present in the nodes
	// array; mergeNode ensures they exist before the edge is added.
	for (const edge of file.edges) {
		const absoluteSource = new URL(edge.source, file.base_url).href;
		const absoluteTarget = new URL(edge.target, file.base_url).href;
		graph.mergeNode(absoluteSource, { size: config.nodeSize });
		graph.mergeNode(absoluteTarget, {
			size: config.nodeSize,
			...(edge.type === "friend" && { color: config.friendNodeColor }),
		});

		const edgeColor = edge.type === "friend" ? config.friendEdgeColor : config.localEdgeColor;
		graph.mergeDirectedEdge(absoluteSource, absoluteTarget, {
			type: edge.type,
			color: edgeColor,
			size: config.edgeSize,
		});
	}

	return graph;
}

/**
 * Assign random initial positions then run ForceAtlas2 to compute
 * a stable layout. Mutates node `x`/`y` attributes in place.
 */
export function assignLayout(graph: Graph, iterations: number): void {
	if (graph.order === 0) return;

	// ForceAtlas2 requires initial positions
	graph.forEachNode((node) => {
		graph.mergeNodeAttributes(node, {
			x: Math.random() * 100,
			y: Math.random() * 100,
		});
	});

	forceAtlas2.assign(graph, {
		iterations,
		settings: forceAtlas2.inferSettings(graph),
	});
}

/** Fetch friend sites' graphs and merge their nodes and edges into `graph`. */
export async function fetchFriendGraphs(
	graph: Graph,
	config: GraphGardenConfig,
	friends: string[],
): Promise<Graph> {
	const origins = new Set<string>();
	for (const friend of friends) {
		try {
			origins.add(new URL(friend).origin);
		} catch {
			console.warn(`fetchFriendGraphs: invalid friend URL: ${friend}`);
		}
	}

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
				graph.mergeNode(absoluteUrl, {
					title: node.title,
					label: node.title,
					size: config.nodeSize,
					color: config.friendNodeColor,
				});
			}

			for (const edge of friendFile.edges) {
				const absoluteSource = new URL(edge.source, friendFile.base_url).href;
				const absoluteTarget = new URL(edge.target, friendFile.base_url).href;
				graph.mergeNode(absoluteSource, { size: config.nodeSize });
				graph.mergeNode(absoluteTarget, {
					size: config.nodeSize,
					...(edge.type === "friend" && { color: config.friendNodeColor }),
				});

				graph.mergeDirectedEdge(absoluteSource, absoluteTarget, {
					type: edge.type,
					color: config.friendEdgeColor,
					size: config.edgeSize,
				});
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
 * `graphgarden.json`, builds a graphology `Graph`, merges friend
 * graphs, and renders an interactive force-directed visualisation
 * via Sigma.js.
 */
export class GraphGarden extends HTMLElement {
	static readonly tagName = "graph-garden" as const;

	/** The local graph built from the protocol file, or `null` before loading. */
	graph: Graph | null = null;

	/** The Sigma renderer instance, or `null` before rendering. */
	renderer: Sigma | null = null;

	/** Shadow DOM container for the Sigma canvas. */
	private container: HTMLDivElement | null = null;

	async connectedCallback(): Promise<void> {
		const shadow = this.shadowRoot ?? this.attachShadow({ mode: "open" });

		const style = document.createElement("style");
		style.textContent = `
			:host { display: block; }
			div { width: 100%; height: 100%; position: relative; }
		`;
		shadow.appendChild(style);

		this.container = document.createElement("div");
		shadow.appendChild(this.container);

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

			const config = this.resolveConfig();
			this.graph = buildGraph(data, config);
			await fetchFriendGraphs(this.graph, config, data.friends);
			assignLayout(this.graph, config.iterations);
			this.initRenderer(config);
		} catch (error) {
			console.error("<graph-garden> error during initialization:", error);
		}
	}

	disconnectedCallback(): void {
		this.renderer?.kill();
		this.renderer = null;

		this.graph?.clear();
		this.graph = null;

		if (this.shadowRoot) {
			this.shadowRoot.innerHTML = "";
		}
		this.container = null;
	}

	private resolveConfig(): GraphGardenConfig {
		const css = (prop: string, fallback: string): string =>
			getComputedStyle(this).getPropertyValue(prop).trim() || fallback;

		const attr = (name: string, fallback: number): number => {
			const raw = this.getAttribute(name);
			if (raw === null) return fallback;
			const n = Number(raw);
			return Number.isFinite(n) && n > 0 ? n : fallback;
		};

		return {
			localNodeColor: css("--gg-local-node-color", DEFAULT_CONFIG.localNodeColor),
			friendNodeColor: css("--gg-friend-node-color", DEFAULT_CONFIG.friendNodeColor),
			localEdgeColor: css("--gg-local-edge-color", DEFAULT_CONFIG.localEdgeColor),
			friendEdgeColor: css("--gg-friend-edge-color", DEFAULT_CONFIG.friendEdgeColor),
			labelColor: css("--gg-label-color", DEFAULT_CONFIG.labelColor),
			nodeSize: attr("node-size", DEFAULT_CONFIG.nodeSize),
			edgeSize: attr("edge-size", DEFAULT_CONFIG.edgeSize),
			labelSize: attr("label-size", DEFAULT_CONFIG.labelSize),
			iterations: attr("iterations", DEFAULT_CONFIG.iterations),
		};
	}

	private initRenderer(config: GraphGardenConfig): void {
		if (!this.graph || !this.container) return;

		// Sigma needs a container with actual dimensions; skip if not visible.
		// This also guards against happy-dom / test environments without WebGL.
		try {
			this.renderer = new Sigma(this.graph, this.container, {
				edgeProgramClasses: {
					internal: EdgeRectangleProgram,
					friend: EdgeRectangleProgram,
				},
				defaultEdgeColor: config.localEdgeColor,
				labelColor: { color: config.labelColor },
				labelSize: config.labelSize,
				renderEdgeLabels: false,
			});

			this.renderer.on("clickNode", ({ node }) => {
				window.location.href = node;
			});

			this.renderer.on("enterNode", () => {
				if (this.container) this.container.style.cursor = "pointer";
			});

			this.renderer.on("leaveNode", () => {
				if (this.container) this.container.style.cursor = "default";
			});
		} catch (error) {
			console.warn("<graph-garden> could not initialize Sigma renderer:", error);
		}
	}
}

if (!customElements.get(GraphGarden.tagName)) {
	customElements.define(GraphGarden.tagName, GraphGarden);
}
