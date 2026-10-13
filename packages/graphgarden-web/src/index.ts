import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import Sigma from "sigma";
import {
	EdgeRectangleProgram,
	type NodeHoverDrawingFunction,
	type NodeLabelDrawingFunction,
} from "sigma/rendering";
import { colorToArray } from "sigma/utils";

const WELL_KNOWN_PATH = "/.well-known/graphgarden.json";
const FETCH_TIMEOUT_MS = 10_000;
// Below this order, Barnes-Hut costs more per iteration than the exact computation
const BARNES_HUT_MIN_ORDER = 1000;
const TIER_SCALES = { small: 1, medium: 1.5, large: 2 };
const FADE_RATIO = 0.85;
const MUTED_LABEL_ALPHA = 0.7;
// Forced labels skip Sigma's label grid, so too many would overlap
const FORCED_LABEL_CAP = 15;

export interface GraphGardenConfig {
	localNodeColor: string;
	friendNodeColor: string;
	frontierNodeColor: string;
	localEdgeColor: string;
	friendEdgeColor: string;
	labelColor: string;
	labelHaloColor: string;
	nodeSize: number;
	edgeSize: number;
	labelSize: number;
	/** ForceAtlas2 iterations. When unset, the count decreases as the graph grows. */
	iterations?: number;
}

export const DEFAULT_CONFIG: GraphGardenConfig = {
	localNodeColor: "#1d8a50",
	friendNodeColor: "#f59e0b",
	frontierNodeColor: "#9ca3af",
	localEdgeColor: "#6cb38d",
	friendEdgeColor: "#fbbf24",
	labelColor: "#334155",
	labelHaloColor: "#ffffff",
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

/**
 * Size each node by its edge count against the graph's deciles: `medium` above the median,
 * `large` above the ninth decile. Mutates node `size` and `tier` in place.
 */
export function assignNodeSizes(graph: Graph, nodeSize: number): void {
	if (graph.order === 0) return;

	const degrees = graph
		.mapNodes((node) => graph.degreeWithoutSelfLoops(node))
		.toSorted((a, b) => a - b);
	const median = quantile(degrees, 0.5);
	const ninthDecile = quantile(degrees, 0.9);

	graph.forEachNode((node) => {
		const degree = graph.degreeWithoutSelfLoops(node);
		const tier = degree > ninthDecile ? "large" : degree > median ? "medium" : "small";
		graph.mergeNodeAttributes(node, { tier, size: nodeSize * TIER_SCALES[tier] });
	});
}

function bestConnected(graph: Graph, nodes: string[]): Set<string> {
	// An untitled node draws no label, so a forced slot on it would be wasted
	const titled = nodes.filter((node) => graph.getNodeAttribute(node, "label"));
	const byDegree = titled.toSorted(
		(a, b) => graph.degreeWithoutSelfLoops(b) - graph.degreeWithoutSelfLoops(a),
	);
	return new Set(byDegree.slice(0, FORCED_LABEL_CAP));
}

/** The `q` quantile of non-empty ascending `sorted`, interpolated between its closest ranks. */
function quantile(sorted: number[], q: number): number {
	const position = (sorted.length - 1) * q;
	const below = sorted[Math.floor(position)];
	const above = sorted[Math.ceil(position)];
	return below + (above - below) * (position - Math.floor(position));
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

	const localOrigin = localOriginOf(graph);
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

function localOriginOf(graph: Graph): string | undefined {
	const base: unknown = graph.getAttribute("base_url");
	return typeof base === "string" ? parseHttpUrl(base)?.origin : undefined;
}

function destinationOf(url: string, localOrigin: string | undefined): string {
	const parsed = parseHttpUrl(url);
	if (parsed === null) return url;
	const path = readablePath(`${parsed.pathname}${parsed.search}`);
	if (parsed.origin === localOrigin) return path;
	return path === "/" ? parsed.host : `${parsed.host}${path}`;
}

function readablePath(path: string): string {
	try {
		return decodeURI(path);
	} catch {
		return path;
	}
}

/** Mix `color` toward `background`, opaque since Sigma renders translucent WebGL colours too light. */
function fade(color: string, background: string): string {
	const from = colorToArray(color);
	const to = colorToArray(background);
	const [r, g, b] = [0, 1, 2].map((i) => Math.round(from[i] + (to[i] - from[i]) * FADE_RATIO));
	return `rgb(${r},${g},${b})`;
}

type LabelData = Parameters<NodeLabelDrawingFunction>[1];
type LabelSettings = Parameters<NodeLabelDrawingFunction>[2];

interface TextStyle {
	font: string;
	letterSpacing: string;
	ink: string;
	alpha: number;
}

function drawHaloText(
	context: CanvasRenderingContext2D,
	text: string,
	x: number,
	top: number,
	halo: string,
	style: TextStyle,
): void {
	// Sigma draws every label on one shared context
	context.save();
	context.font = style.font;
	context.letterSpacing = style.letterSpacing;
	context.textAlign = "center";
	context.textBaseline = "top";
	context.lineJoin = "round";
	context.lineWidth = 4;
	context.strokeStyle = halo;
	context.strokeText(text, x, top);
	context.fillStyle = style.ink;
	context.globalAlpha = style.alpha;
	context.fillText(text, x, top);
	context.restore();
}

/** Returns where the line below the label starts. */
function drawMapLabel(
	context: CanvasRenderingContext2D,
	data: LabelData,
	settings: LabelSettings,
	text: string,
	halo: string,
	emphasised: boolean,
): number {
	const large = data.tier === "large";
	const small = data.tier === "small";
	const size = large ? settings.labelSize * 0.9 : settings.labelSize;
	const top = labelTop(data);
	drawHaloText(context, large ? text.toUpperCase() : text, data.x, top, halo, {
		font: `${small ? "italic " : ""}${large ? 600 : 400} ${size}px ${settings.labelFont}`,
		letterSpacing: large ? `${size / 10}px` : "0px",
		ink: settings.labelColor.color ?? "#000",
		alpha: small && !emphasised ? MUTED_LABEL_ALPHA : 1,
	});
	return top + settings.labelSize + 3;
}

function labelTop(data: LabelData): number {
	return data.y + data.size + 4;
}

/** Keeps its letter case, since paths are case-sensitive. */
function drawDestination(
	context: CanvasRenderingContext2D,
	data: LabelData,
	settings: LabelSettings,
	text: string,
	top: number,
	halo: string,
	alpha: number,
): void {
	drawHaloText(context, text, data.x, top, halo, {
		font: `italic 400 ${settings.labelSize * 0.9}px ${settings.labelFont}`,
		letterSpacing: "0px",
		ink: settings.labelColor.color ?? "#000",
		alpha,
	});
}

function mapLabelDrawer(halo: string): NodeLabelDrawingFunction {
	return (context, data, settings) => {
		if (data.label) drawMapLabel(context, data, settings, data.label, halo, false);
	};
}

/** Redraws the label glyph for glyph over the idle one, in full ink. */
function mapHoverDrawer(
	halo: string,
	localOrigin: string | undefined,
	hovered: () => string | null,
): NodeHoverDrawingFunction {
	return (context, data, settings) => {
		// Sigma keeps drawing a node as hovered after the pointer leaves the canvas from it
		if (data.key !== hovered()) return;

		context.save();
		context.beginPath();
		context.arc(data.x, data.y, data.size + 3, 0, Math.PI * 2);
		context.lineWidth = 1.5;
		context.strokeStyle = data.color;
		context.stroke();
		context.restore();

		const destination = destinationOf(data.key, localOrigin);
		if (!data.label) {
			drawDestination(context, data, settings, destination, labelTop(data), halo, 1);
			return;
		}
		const next = drawMapLabel(context, data, settings, data.label, halo, true);
		drawDestination(context, data, settings, destination, next, halo, MUTED_LABEL_ALPHA);
	};
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

	private hovered: { node: string; labelledNeighbours: Set<string> } | null = null;

	private leftCanvasFrom: string | null = null;

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
		this.hovered = null;
		this.leftCanvasFrom = null;

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

			assignNodeSizes(graph, config.nodeSize);
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
			labelHaloColor: css("--gg-label-halo-color", DEFAULT_CONFIG.labelHaloColor),
			nodeSize: attr("node-size") ?? DEFAULT_CONFIG.nodeSize,
			edgeSize: attr("edge-size") ?? DEFAULT_CONFIG.edgeSize,
			labelSize: attr("label-size") ?? DEFAULT_CONFIG.labelSize,
			iterations: attr("iterations"),
		};
	}

	private initRenderer(config: GraphGardenConfig): void {
		const graph = this.graph;
		if (!graph || !this.container) return;
		// Sigma's label grid would otherwise hide some large nodes' labels
		const labelledHubs = bestConnected(
			graph,
			graph.filterNodes((_node, attributes) => attributes.tier === "large"),
		);

		// Sigma throws without WebGL, as in happy-dom
		try {
			this.renderer = new Sigma(graph, this.container, {
				edgeProgramClasses: {
					internal: EdgeRectangleProgram,
					friend: EdgeRectangleProgram,
				},
				defaultEdgeColor: config.localEdgeColor,
				labelColor: { color: config.labelColor },
				labelSize: config.labelSize,
				labelFont: getComputedStyle(this).fontFamily || "sans-serif",
				renderEdgeLabels: false,
				defaultDrawNodeLabel: mapLabelDrawer(config.labelHaloColor),
				defaultDrawNodeHover: mapHoverDrawer(
					config.labelHaloColor,
					localOriginOf(graph),
					() => this.hovered?.node ?? null,
				),
				nodeReducer: (node, attributes) => {
					const data = { ...attributes, forceLabel: labelledHubs.has(node) };
					const hovered = this.hovered;
					if (hovered === null || node === hovered.node) return data;
					if (graph.areNeighbors(node, hovered.node)) {
						return { ...data, forceLabel: hovered.labelledNeighbours.has(node) };
					}
					return {
						...data,
						label: null,
						forceLabel: false,
						color: fade(attributes.color, config.labelHaloColor),
					};
				},
				edgeReducer: (edge, attributes) => {
					const hovered = this.hovered;
					if (hovered === null || graph.hasExtremity(edge, hovered.node)) return attributes;
					return { ...attributes, color: fade(attributes.color, config.labelHaloColor) };
				},
			});

			this.renderer.on("clickNode", ({ node }) => {
				if (parseHttpUrl(node)) window.location.href = node;
			});

			// A finger has no hover, and Sigma emits no leaveNode when it lifts
			this.renderer.on("enterNode", ({ node, event }) => {
				if (!event.original.type.startsWith("touch")) this.hover(node);
			});

			this.renderer.on("leaveNode", ({ node, event }) => {
				this.hover(null);
				// Sigma still holds a node the pointer left the canvas from, so coming back onto it emits no enterNode
				this.leftCanvasFrom = event.original.type === "mouseleave" ? node : null;
			});

			this.renderer.on("enterStage", () => {
				const node = this.leftCanvasFrom;
				this.leftCanvasFrom = null;
				if (node !== null) this.hover(node);
			});

			// Canvas text drawn before its web font loads keeps the fallback font. happy-dom has no FontFaceSet.
			void document.fonts?.ready
				.then(() => this.renderer?.refresh())
				.catch((error: unknown) => console.warn("<graph-garden> could not redraw labels:", error));
		} catch (error) {
			console.warn("<graph-garden> could not initialize Sigma renderer:", error);
		}
	}

	private hover(node: string | null): void {
		// Sigma emits leaveNode for a finger that crossed off a node too, which we never hovered
		if (node === (this.hovered?.node ?? null)) return;
		if (this.container) this.container.style.cursor = node === null ? "default" : "pointer";
		this.hovered =
			node === null || this.graph === null
				? null
				: { node, labelledNeighbours: bestConnected(this.graph, this.graph.neighbors(node)) };
		// Moving between nodes emits leaveNode then enterNode, which share one scheduled render
		this.renderer?.refresh({ schedule: true });
	}
}

if (!customElements.get(GraphGarden.tagName)) {
	customElements.define(GraphGarden.tagName, GraphGarden);
}
