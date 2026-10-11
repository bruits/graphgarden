import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import Sigma from "sigma";
import { EdgeRectangleProgram } from "sigma/rendering";

const WELL_KNOWN_PATH = "/.well-known/graphgarden.json";
const FETCH_TIMEOUT_MS = 10_000;
// Below this order, Barnes-Hut costs more per iteration than the exact computation
const BARNES_HUT_MIN_ORDER = 1000;

export interface GraphGardenConfig {
	localNodeColor: string;
	friendNodeColor: string;
	frontierNodeColor: string;
	localEdgeColor: string;
	friendEdgeColor: string;
	labelColor: string;
	nodeSize: number;
	edgeSize: number;
	labelSize: number;
	/** ForceAtlas2 iterations. When unset, the count decreases as the graph grows. */
	iterations?: number;
}

export const DEFAULT_CONFIG: GraphGardenConfig = {
	localNodeColor: "#6366f1",
	friendNodeColor: "#f59e0b",
	frontierNodeColor: "#9ca3af",
	localEdgeColor: "#94a3b8",
	friendEdgeColor: "#fbbf24",
	labelColor: "#334155",
	nodeSize: 4,
	edgeSize: 0.5,
	labelSize: 12,
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
	friends?: string[];
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

function parseHttpUrl(url: string, base?: string): URL | null {
	try {
		const parsed = new URL(url, base);
		return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : null;
	} catch {
		return null;
	}
}

/** Runtime check that `value` matches the {@link GraphGardenFile} shape. */
export function isGraphGardenFile(value: unknown): value is GraphGardenFile {
	if (typeof value !== "object" || value === null) return false;
	const obj = value as Record<string, unknown>;

	if (typeof obj.version !== "string") return false;
	if (typeof obj.generated_at !== "string") return false;
	if (typeof obj.base_url !== "string" || parseHttpUrl(obj.base_url) === null) return false;

	if (typeof obj.site !== "object" || obj.site === null) return false;
	const site = obj.site as Record<string, unknown>;
	if (typeof site.title !== "string") return false;
	if (site.description !== undefined && typeof site.description !== "string") return false;
	if (site.language !== undefined && typeof site.language !== "string") return false;

	if (
		obj.friends !== undefined &&
		(!Array.isArray(obj.friends) || !obj.friends.every((f: unknown) => typeof f === "string"))
	)
		return false;

	if (!Array.isArray(obj.nodes) || !obj.nodes.every(isNode)) return false;
	if (!Array.isArray(obj.edges) || !obj.edges.every(isEdge)) return false;

	return true;
}

/** Build a graphology `Graph` from a parsed {@link GraphGardenFile}. */
export function buildGraph(file: GraphGardenFile, config: GraphGardenConfig): Graph {
	const graph = new Graph();
	graph.replaceAttributes({ base_url: file.base_url, site: file.site });
	mergeFile(graph, file, config, "local");
	return graph;
}

function mergeFile(
	graph: Graph,
	file: GraphGardenFile,
	config: GraphGardenConfig,
	owner: "local" | "friend",
): void {
	const origin = parseHttpUrl(file.base_url)?.origin;
	if (origin === undefined) return;

	const nodeColor = owner === "local" ? config.localNodeColor : config.friendNodeColor;
	const declared = new Set<string>();
	for (const node of file.nodes) {
		const url = parseHttpUrl(node.url, file.base_url);
		if (url === null || url.origin !== origin) continue;
		declared.add(url.href);
		graph.mergeNode(url.href, {
			title: node.title,
			label: node.title,
			size: config.nodeSize,
			color: nodeColor,
		});
	}

	for (const edge of file.edges) {
		const source = parseHttpUrl(edge.source, file.base_url)?.href;
		const target = parseHttpUrl(edge.target, file.base_url)?.href;
		if (source === undefined || target === undefined || !declared.has(source)) continue;

		if (!graph.hasNode(target)) {
			const friendLink = owner === "friend" && edge.type === "friend";
			graph.addNode(target, {
				size: config.nodeSize,
				color: friendLink ? config.friendNodeColor : config.frontierNodeColor,
			});
		}

		graph.mergeDirectedEdge(source, target, {
			type: edge.type,
			color:
				owner === "local" && edge.type === "internal"
					? config.localEdgeColor
					: config.friendEdgeColor,
			size: config.edgeSize,
		});
	}
}

/**
 * Assign random initial positions then run ForceAtlas2 to compute
 * a stable layout. Mutates node `x`/`y` attributes in place.
 */
export function assignLayout(graph: Graph, iterations = defaultIterations(graph.order)): void {
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
		settings: {
			...forceAtlas2.inferSettings(graph),
			barnesHutOptimize: graph.order >= BARNES_HUT_MIN_ORDER,
		},
	});
}

/** Fewer iterations as the graph grows, so the synchronous layout stays around half a second. */
function defaultIterations(order: number): number {
	return Math.max(50, Math.min(200, Math.round(200_000 / order)));
}

async function fetchProtocolFile(url: string, signal?: AbortSignal): Promise<GraphGardenFile> {
	const controller = new AbortController();
	const cancel = () => controller.abort(signal?.reason);
	if (signal?.aborted) cancel();
	signal?.addEventListener("abort", cancel);
	const timer = setTimeout(
		() => controller.abort(new DOMException(`${url} timed out`, "TimeoutError")),
		FETCH_TIMEOUT_MS,
	);

	try {
		const response = await fetch(url, { signal: controller.signal });
		if (!response.ok) throw new Error(`${url} responded ${response.status} ${response.statusText}`);
		const data: unknown = await response.json();
		if (!isGraphGardenFile(data)) throw new Error(`${url} is not a GraphGarden file`);
		return data;
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener("abort", cancel);
	}
}

/** Fetch friend sites' graphs and merge their nodes and edges into `graph`. */
export async function fetchFriendGraphs(
	graph: Graph,
	config: GraphGardenConfig,
	friends: string[] = [],
	signal?: AbortSignal,
): Promise<Graph> {
	const origins = new Set<string>();
	for (const friend of friends) {
		const url = parseHttpUrl(friend);
		if (url) origins.add(url.origin);
		else console.warn(`fetchFriendGraphs: invalid friend URL: ${friend}`);
	}

	const results = await Promise.allSettled(
		[...origins].map((origin) => fetchProtocolFile(`${origin}${WELL_KNOWN_PATH}`, signal)),
	);
	if (signal?.aborted) return graph;

	const localBase: unknown = graph.getAttribute("base_url");
	const localOrigin = typeof localBase === "string" ? parseHttpUrl(localBase)?.origin : undefined;
	for (const result of results) {
		if (result.status === "rejected") {
			console.warn("fetchFriendGraphs: skipped a friend:", result.reason);
		} else if (parseHttpUrl(result.value.base_url)?.origin === localOrigin) {
			console.warn(`fetchFriendGraphs: skipped a friend claiming to be ${localOrigin}`);
		} else {
			mergeFile(graph, result.value, config, "friend");
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

	/** The rendered graph, or `null` until loaded. */
	graph: Graph | null = null;

	/** The Sigma renderer instance, or `null` before rendering. */
	renderer: Sigma | null = null;

	/** Settles once the current load has rendered the graph, failed, or been cancelled. */
	ready: Promise<void> = Promise.resolve();

	/** Shadow DOM container for the Sigma canvas. */
	private container: HTMLDivElement | null = null;

	private loading: AbortController | null = null;

	connectedCallback(): void {
		const style = document.createElement("style");
		style.textContent = `
			:host { display: block; }
			div { width: 100%; height: 100%; position: relative; }
		`;
		this.container = document.createElement("div");
		(this.shadowRoot ?? this.attachShadow({ mode: "open" })).replaceChildren(style, this.container);

		this.loading = new AbortController();
		this.ready = this.load(this.loading.signal);
	}

	disconnectedCallback(): void {
		this.loading?.abort();
		this.loading = null;

		this.renderer?.kill();
		this.renderer = null;

		this.graph?.clear();
		this.graph = null;

		this.shadowRoot?.replaceChildren();
		this.container = null;
	}

	private async load(signal: AbortSignal): Promise<void> {
		try {
			const file = await fetchProtocolFile(WELL_KNOWN_PATH, signal);
			const config = this.resolveConfig();
			const graph = buildGraph(file, config);
			await fetchFriendGraphs(graph, config, file.friends, signal);
			// fetchFriendGraphs settles normally after an abort
			if (signal.aborted) return;

			assignLayout(graph, config.iterations);
			this.graph = graph;
			this.initRenderer(config);
		} catch (error) {
			if (!signal.aborted) console.error("<graph-garden> could not load the graph:", error);
		}
	}

	private resolveConfig(): GraphGardenConfig {
		const css = (prop: string, fallback: string): string =>
			getComputedStyle(this).getPropertyValue(prop).trim() || fallback;

		const attr = (name: string): number | undefined => {
			const raw = this.getAttribute(name);
			if (raw === null) return undefined;
			const n = Number(raw);
			return Number.isFinite(n) && n > 0 ? n : undefined;
		};

		return {
			localNodeColor: css("--gg-local-node-color", DEFAULT_CONFIG.localNodeColor),
			friendNodeColor: css("--gg-friend-node-color", DEFAULT_CONFIG.friendNodeColor),
			frontierNodeColor: css("--gg-frontier-node-color", DEFAULT_CONFIG.frontierNodeColor),
			localEdgeColor: css("--gg-local-edge-color", DEFAULT_CONFIG.localEdgeColor),
			friendEdgeColor: css("--gg-friend-edge-color", DEFAULT_CONFIG.friendEdgeColor),
			labelColor: css("--gg-label-color", DEFAULT_CONFIG.labelColor),
			nodeSize: attr("node-size") ?? DEFAULT_CONFIG.nodeSize,
			edgeSize: attr("edge-size") ?? DEFAULT_CONFIG.edgeSize,
			labelSize: attr("label-size") ?? DEFAULT_CONFIG.labelSize,
			iterations: attr("iterations"),
		};
	}

	private initRenderer(config: GraphGardenConfig): void {
		if (!this.graph || !this.container) return;

		// Sigma throws without WebGL, as in happy-dom
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
				if (parseHttpUrl(node)) window.location.href = node;
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
