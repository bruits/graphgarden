import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import Sigma from "sigma";
import {
	EdgeRectangleProgram,
	NodeCircleProgram,
	type NodeHoverDrawingFunction,
	type NodeLabelDrawingFunction,
} from "sigma/rendering";
import { colorToArray } from "sigma/utils";

const WELL_KNOWN_PATH = "/.well-known/graphgarden.json";
const FETCH_TIMEOUT_MS = 10_000;
// Below this order, Barnes-Hut costs more per iteration than the exact computation
const BARNES_HUT_MIN_ORDER = 1000;
// Pulls groups closer, so each fills more of the fitted map
const LAYOUT_GRAVITY = 0.25;
const TIER_SCALES = { small: 1, medium: 1.5, large: 2 };
const FADE_RATIO = 0.85;
const SITE_FADE_RATIO = 0.65;
const MUTED_LABEL_ALPHA = 0.7;
const SHORT_LABEL_LENGTH = 30;
const TITLE_SEPARATORS = [" - ", " – ", " — ", " | ", " · "];
const LABEL_MARGIN = { x: 6, y: 3 };
// Sigma's private X_LABEL_MARGIN and Y_LABEL_MARGIN, how far off the view a node's centre may lie
// and still have its label drawn
const SIGMA_LABEL_REACH = { x: 150, y: 50 };
// Some room around the whole map, past which zooming out would only pack it tighter
const MAX_CAMERA_RATIO = 1.5;

export interface GraphGardenConfig {
	localNodeColor: string;
	friendNodeColor: string;
	frontierNodeColor: string;
	localEdgeColor: string;
	friendEdgeColor: string;
	frontierEdgeColor: string;
	highlightNodeColor: string;
	highlightEdgeColor: string;
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
	frontierEdgeColor: "#adb3bc",
	highlightNodeColor: "#b955a4",
	highlightEdgeColor: "#d290c4",
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

/** Who describes a page: the local site, a friend, or nobody for a frontier page. */
type NodeKind = "local" | "friend" | "frontier";

function mergeFile(
	graph: Graph,
	file: GraphGardenFile,
	config: GraphGardenConfig,
	owner: "local" | "friend",
): void {
	const origin = parseHttpUrl(file.base_url)?.origin;
	if (origin === undefined) return;

	const declared = new Set<string>();
	for (const node of file.nodes) {
		const url = parseHttpUrl(node.url, file.base_url);
		if (url === null || url.origin !== origin) continue;
		declared.add(url.href);
		const type = programOf(url);
		graph.mergeNode(url.href, {
			title: node.title,
			// A home page keeps the site's name, which its label alone carries
			label: shortLabel(node.title, type === "home" ? undefined : file.site.title),
			size: config.nodeSize,
			kind: owner,
			origin,
			type,
			color: nodeColor(owner, config),
		});
		// An earlier file may have linked here while nobody described the page
		graph.forEachInEdge(url.href, (edge, _attributes, source) => {
			graph.setEdgeAttribute(edge, "color", edgeColor(graph, source, url.href, config));
		});
	}

	for (const edge of file.edges) {
		const source = parseHttpUrl(edge.source, file.base_url)?.href;
		const target = parseHttpUrl(edge.target, file.base_url);
		if (source === undefined || target === null || !declared.has(source)) continue;

		if (!graph.hasNode(target.href)) {
			graph.addNode(target.href, {
				size: config.nodeSize,
				kind: "frontier",
				origin: target.origin,
				type: programOf(target),
				color: nodeColor("frontier", config),
			});
		}

		graph.mergeDirectedEdge(source, target.href, {
			type: edge.type,
			color: edgeColor(graph, source, target.href, config),
			size: config.edgeSize,
		});
	}
}

/** Drops the site's name from a page title, then cuts it at a word near `SHORT_LABEL_LENGTH`. */
function shortLabel(title: string, siteTitle?: string): string {
	const label = siteTitle ? withoutSiteTitle(title, siteTitle) : title;
	// A string holds at least as many UTF-16 code units as characters
	if (label.length <= SHORT_LABEL_LENGTH) return label;
	const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(label);
	const characters = Array.from(segments, ({ segment }) => segment);
	if (characters.length <= SHORT_LABEL_LENGTH) return label;
	const cut = characters.slice(0, SHORT_LABEL_LENGTH).join("");
	// The cut may fall right after a word, or inside one
	const space = /[\s\p{P}]/u.test(characters[SHORT_LABEL_LENGTH])
		? cut.length
		: cut.search(/\s\S*$/);
	const words = space >= cut.length / 2 ? cut.slice(0, space) : cut;
	return `${words.replace(/[\s\p{P}]+$/u, "")}…`;
}

function withoutSiteTitle(title: string, siteTitle: string): string {
	for (const separator of TITLE_SEPARATORS) {
		const suffix = `${separator}${siteTitle}`;
		if (title.length > suffix.length && sameText(title.slice(-suffix.length), suffix)) {
			return title.slice(0, -suffix.length);
		}
		const prefix = `${siteTitle}${separator}`;
		if (title.length > prefix.length && sameText(title.slice(0, prefix.length), prefix)) {
			return title.slice(prefix.length);
		}
	}
	return title;
}

function sameText(a: string, b: string): boolean {
	return a.toLowerCase() === b.toLowerCase();
}

function programOf(url: URL): "home" | "circle" {
	return url.href === `${url.origin}/` ? "home" : "circle";
}

function nodeColor(kind: NodeKind, config: GraphGardenConfig): string {
	if (kind === "local") return config.localNodeColor;
	return kind === "friend" ? config.friendNodeColor : config.frontierNodeColor;
}

function edgeColor(
	graph: Graph,
	source: string,
	target: string,
	config: GraphGardenConfig,
): string {
	const targetKind: NodeKind = graph.getNodeAttribute(target, "kind");
	if (targetKind === "frontier") return config.frontierEdgeColor;
	const local = targetKind === "local" && graph.getNodeAttribute(source, "kind") === "local";
	return local ? config.localEdgeColor : config.friendEdgeColor;
}

/**
 * Assign random initial positions then run ForceAtlas2 to compute
 * a stable layout. Mutates node `x`/`y` attributes in place.
 *
 * A group of nodes linked to nothing else is laid out beside the best connected node sharing its
 * `origin` attribute, through edges added for the layout and dropped before it returns.
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

	// Linked to nothing else, a page or group would drift off and shrink the map Sigma fits to its frame
	const anchors = anchorStrayComponents(graph);
	try {
		forceAtlas2.assign(graph, {
			iterations,
			settings: {
				...forceAtlas2.inferSettings(graph),
				barnesHutOptimize: graph.order >= BARNES_HUT_MIN_ORDER,
				gravity: LAYOUT_GRAVITY,
			},
		});
	} finally {
		for (const edge of anchors) graph.dropEdge(edge);
	}
}

/**
 * Links each connected component but the largest to its site's best anchor in the largest,
 * through the component's own best anchor of that site. Returns the added edges.
 */
function anchorStrayComponents(graph: Graph): string[] {
	const components = connectedComponents(graph);
	const largest = components.reduce((a, b) => (b.length > a.length ? b : a));
	const hubs = new Map<unknown, string>();
	for (const node of largest) {
		const origin: unknown = graph.getNodeAttribute(node, "origin");
		const hub = hubs.get(origin);
		if (hub === undefined || isBetterAnchor(graph, node, hub)) hubs.set(origin, node);
	}

	const anchors: string[] = [];
	for (const component of components) {
		if (component === largest) continue;
		let anchor: [node: string, hub: string] | undefined;
		for (const node of component) {
			const hub = hubs.get(graph.getNodeAttribute(node, "origin"));
			if (hub === undefined) continue;
			if (anchor === undefined || isBetterAnchor(graph, node, anchor[0])) anchor = [node, hub];
		}
		if (anchor !== undefined) anchors.push(graph.addEdge(...anchor));
	}
	return anchors;
}

/** Nodes grouped by connected component, whatever the edges' direction. */
function connectedComponents(graph: Graph): string[][] {
	const seen = new Set<string>();
	const components: string[][] = [];
	graph.forEachNode((start) => {
		if (seen.has(start)) return;
		seen.add(start);
		const component = [start];
		for (let i = 0; i < component.length; i++) {
			graph.forEachNeighbor(component[i], (neighbour) => {
				if (seen.has(neighbour)) return;
				seen.add(neighbour);
				component.push(neighbour);
			});
		}
		components.push(component);
	});
	return components;
}

/** A page some file describes beats a frontier one, which may belong to another site, then the better connected wins. */
function isBetterAnchor(graph: Graph, node: string, than: string): boolean {
	const described = graph.getNodeAttribute(node, "kind") !== "frontier";
	if (described !== (graph.getNodeAttribute(than, "kind") !== "frontier")) return described;
	return graph.degreeWithoutSelfLoops(node) > graph.degreeWithoutSelfLoops(than);
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

interface Site {
	kind: NodeKind;
	origin: string;
}

function siteOf(attributes: Record<string, unknown>): Site | null {
	const { kind, origin } = attributes as { kind: NodeKind; origin: string };
	return kind === "frontier" ? null : { kind, origin };
}

function inSite(attributes: Record<string, unknown>, site: Site | null): boolean {
	return site !== null && attributes.kind === site.kind && attributes.origin === site.origin;
}

/** Mix `color` toward `background`, opaque since Sigma renders translucent WebGL colours too light. */
function fade(color: string, background: string, ratio: number): string {
	const from = colorToArray(color);
	const to = colorToArray(background);
	const [r, g, b] = [0, 1, 2].map((i) => Math.round(from[i] + (to[i] - from[i]) * ratio));
	return `rgb(${r},${g},${b})`;
}

/** The hole hides the edges that meet under the node. */
function createRingProgram(holeColor: string) {
	const hole = colorToArray(holeColor)
		.slice(0, 3)
		.map((channel) => (channel / 255).toFixed(4));
	// NodeCircleProgram's fragment shader, plus the hole
	const fragmentShader = /* glsl */ `
precision highp float;

varying vec4 v_color;
varying vec2 v_diffVector;
varying float v_radius;

uniform float u_correctionRatio;

const vec4 transparent = vec4(0.0, 0.0, 0.0, 0.0);
const vec4 holeColor = vec4(${hole.join(", ")}, 1.0);

void main(void) {
  float border = u_correctionRatio * 2.0;
  float dist = length(v_diffVector);

  #ifdef PICKING_MODE
  gl_FragColor = dist > v_radius ? transparent : v_color;
  #else
  float hole = 0.52 * v_radius;
  vec4 color = mix(v_color, holeColor, 1.0 - smoothstep(hole - border * 0.4, hole + border * 0.4, dist));
  gl_FragColor = mix(color, transparent, clamp((dist - v_radius + border) / border, 0.0, 1.0));
  #endif
}
`;
	return class NodeRingProgram extends NodeCircleProgram {
		getDefinition() {
			return { ...super.getDefinition(), FRAGMENT_SHADER_SOURCE: fragmentShader };
		}
	};
}

type LabelSettings = Parameters<NodeLabelDrawingFunction>[2];

interface Typeset {
	text: string;
	font: string;
	letterSpacing: string;
}

function drawHaloText(
	context: CanvasRenderingContext2D,
	line: Typeset,
	x: number,
	top: number,
	halo: string,
	ink: string,
	alpha: number,
): void {
	// Sigma draws every label on one shared context
	context.save();
	context.font = line.font;
	context.letterSpacing = line.letterSpacing;
	context.textAlign = "center";
	context.textBaseline = "top";
	context.lineJoin = "round";
	context.lineWidth = 4;
	context.strokeStyle = halo;
	context.strokeText(line.text, x, top);
	context.fillStyle = ink;
	context.globalAlpha = alpha;
	context.fillText(line.text, x, top);
	context.restore();
}

function typesetLabel(text: string, tier: unknown, settings: LabelSettings): Typeset {
	const large = tier === "large";
	const size = large ? settings.labelSize * 0.9 : settings.labelSize;
	return {
		text: large ? text.toUpperCase() : text,
		font: `${tier === "small" ? "italic " : ""}${large ? 600 : 400} ${size}px ${settings.labelFont}`,
		letterSpacing: large ? `${size / 10}px` : "0px",
	};
}

/** Keeps its letter case, since paths are case-sensitive. */
function typesetDestination(text: string, settings: LabelSettings): Typeset {
	return {
		text,
		font: `italic 400 ${settings.labelSize * 0.9}px ${settings.labelFont}`,
		letterSpacing: "0px",
	};
}

function hoverLines(
	key: string,
	node: Record<string, unknown>,
	settings: LabelSettings,
	localOrigin: string | undefined,
): Typeset[] {
	const destination = typesetDestination(destinationOf(key, localOrigin), settings);
	const title = typeof node.title === "string" ? node.title : "";
	return title ? [typesetLabel(title, node.tier, settings), destination] : [destination];
}

function labelTop(node: { y: number; size: number }): number {
	return node.y + node.size + 4;
}

function lineHeight(settings: LabelSettings): number {
	return settings.labelSize + 3;
}

interface LabelBox {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

/** The room `lines` lines `width` wide take, margin included, centred on `x` from `top` down. */
function labelBox(
	width: number,
	lines: number,
	x: number,
	top: number,
	settings: LabelSettings,
): LabelBox {
	return {
		left: x - width / 2 - LABEL_MARGIN.x,
		right: x + width / 2 + LABEL_MARGIN.x,
		top: top - LABEL_MARGIN.y,
		bottom: top + lines * lineHeight(settings) + LABEL_MARGIN.y,
	};
}

function textWidth(context: CanvasRenderingContext2D, line: Typeset): number {
	context.save();
	context.font = line.font;
	context.letterSpacing = line.letterSpacing;
	const { width } = context.measureText(line.text);
	context.restore();
	return width;
}

function overlaps(a: LabelBox, b: LabelBox): boolean {
	return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** Keeps each box, in order, that overlaps none of `taken` and none kept before it. */
function placeApart(candidates: { node: string; box: LabelBox }[], taken: LabelBox[]): Set<string> {
	const boxes = [...taken];
	const placed = new Set<string>();
	for (const { node, box } of candidates) {
		if (boxes.some((other) => overlaps(other, box))) continue;
		boxes.push(box);
		placed.add(node);
	}
	return placed;
}

function mapLabelDrawer(
	halo: string,
	placed: (context: CanvasRenderingContext2D, settings: LabelSettings) => Set<string>,
): NodeLabelDrawingFunction {
	return (context, data, settings) => {
		if (!data.label || !placed(context, settings).has(data.key)) return;
		drawHaloText(
			context,
			typesetLabel(data.label, data.tier, settings),
			data.x,
			labelTop(data),
			halo,
			settings.labelColor.color ?? "#000",
			data.tier === "small" ? MUTED_LABEL_ALPHA : 1,
		);
	};
}

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

		let top = labelTop(data);
		for (const [i, line] of hoverLines(data.key, data, settings, localOrigin).entries()) {
			const ink = settings.labelColor.color ?? "#000";
			drawHaloText(context, line, data.x, top, halo, ink, i === 0 ? 1 : MUTED_LABEL_ALPHA);
			top += lineHeight(settings);
		}
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

	private hovered: { node: string; site: Site | null } | null = null;

	private leftCanvasFrom: string | null = null;

	/** The labels drawn in the current frame, placed when Sigma draws its first one. */
	private placedLabels: Set<string> | null = null;

	/** Each label's measured width, kept until the page fonts load. */
	private labelWidths = new Map<string, number>();

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
		this.placedLabels = null;
		this.labelWidths.clear();

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
			this.initRenderer(config, signal);
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
			frontierEdgeColor: css("--gg-frontier-edge-color", DEFAULT_CONFIG.frontierEdgeColor),
			highlightNodeColor: css("--gg-highlight-node-color", DEFAULT_CONFIG.highlightNodeColor),
			highlightEdgeColor: css("--gg-highlight-edge-color", DEFAULT_CONFIG.highlightEdgeColor),
			labelColor: css("--gg-label-color", DEFAULT_CONFIG.labelColor),
			labelHaloColor: css("--gg-label-halo-color", DEFAULT_CONFIG.labelHaloColor),
			nodeSize: attr("node-size") ?? DEFAULT_CONFIG.nodeSize,
			edgeSize: attr("edge-size") ?? DEFAULT_CONFIG.edgeSize,
			labelSize: attr("label-size") ?? DEFAULT_CONFIG.labelSize,
			iterations: attr("iterations"),
		};
	}

	private initRenderer(config: GraphGardenConfig, signal: AbortSignal): void {
		const graph = this.graph;
		if (!graph || !this.container) return;

		// Sigma throws without WebGL, as in happy-dom
		try {
			this.renderer = new Sigma(graph, this.container, {
				nodeProgramClasses: { home: createRingProgram(config.labelHaloColor) },
				edgeProgramClasses: {
					internal: EdgeRectangleProgram,
					friend: EdgeRectangleProgram,
				},
				defaultEdgeColor: config.localEdgeColor,
				labelColor: { color: config.labelColor },
				labelSize: config.labelSize,
				labelFont: getComputedStyle(this).fontFamily || "sans-serif",
				renderEdgeLabels: false,
				// Zoomed out, nodes shrink with the map, so the smaller ones drop their labels
				zoomToSizeRatioFunction: (ratio) => (ratio > 1 ? ratio : Math.sqrt(ratio)),
				maxCameraRatio: MAX_CAMERA_RATIO,
				defaultDrawNodeLabel: mapLabelDrawer(
					config.labelHaloColor,
					(context, settings) => (this.placedLabels ??= this.placeLabels(context, settings)),
				),
				defaultDrawNodeHover: mapHoverDrawer(
					config.labelHaloColor,
					localOriginOf(graph),
					() => this.hovered?.node ?? null,
				),
				nodeReducer: (node, attributes) => {
					// Sigma's label grid would hide labels that `placeLabels` keeps, so every label skips it
					const data = { ...attributes, forceLabel: Boolean(attributes.label) };
					const hovered = this.hovered;
					if (hovered === null) return data;
					const site = inSite(attributes, hovered.site);
					const color =
						site && hovered.site?.kind === "friend" ? config.highlightNodeColor : attributes.color;
					if (node === hovered.node || graph.areNeighbors(node, hovered.node)) {
						return { ...data, color };
					}
					return {
						...data,
						color: fade(color, config.labelHaloColor, site ? SITE_FADE_RATIO : FADE_RATIO),
					};
				},
				edgeReducer: (edge, attributes) => {
					const hovered = this.hovered;
					if (hovered === null) return attributes;
					const friend = hovered.site?.kind === "friend";
					if (graph.hasExtremity(edge, hovered.node)) {
						if (!friend) return attributes;
						const other = graph.getNodeAttributes(graph.opposite(hovered.node, edge));
						if (inSite(other, hovered.site)) {
							return { ...attributes, color: config.highlightEdgeColor };
						}
						if (other.kind === "local") return { ...attributes, color: config.localEdgeColor };
						return attributes;
					}
					const site =
						inSite(graph.getSourceAttributes(edge), hovered.site) &&
						inSite(graph.getTargetAttributes(edge), hovered.site);
					const color = site && friend ? config.highlightEdgeColor : attributes.color;
					return {
						...attributes,
						color: fade(color, config.labelHaloColor, site ? SITE_FADE_RATIO : FADE_RATIO),
					};
				},
			});

			this.renderer.on("beforeRender", () => {
				this.placedLabels = null;
			});
			// Sigma draws its first frame inside its constructor, before `placeLabels` can read it. A second
			// frame, which reprocesses nothing, has the labels drawn by the time `ready` settles.
			this.renderer.refresh({ partialGraph: { nodes: [] }, skipIndexation: true });

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

			// Canvas draws and measures text in a fallback font until its face loads, which a weight or style
			// the page itself does not use only starts on first use. happy-dom has no FontFaceSet.
			document.fonts?.addEventListener(
				"loadingdone",
				() => {
					this.labelWidths.clear();
					this.renderer?.refresh({ schedule: true });
				},
				{ signal },
			);
		} catch (error) {
			console.warn("<graph-garden> could not initialize Sigma renderer:", error);
		}
	}

	/**
	 * Places the labels of better connected nodes first, and hides any that would overlap one already
	 * placed. Around a hovered node, only the neighbours placed at rest keep theirs, clear of its title.
	 */
	private placeLabels(context: CanvasRenderingContext2D, settings: LabelSettings): Set<string> {
		const { renderer, graph, hovered } = this;
		if (renderer === null || graph === null) return new Set();
		const { width, height } = renderer.getDimensions();
		const view = { left: 0, right: width, top: 0, bottom: height };
		const reach = {
			left: -SIGMA_LABEL_REACH.x,
			right: width + SIGMA_LABEL_REACH.x,
			top: -SIGMA_LABEL_REACH.y,
			bottom: height + SIGMA_LABEL_REACH.y,
		};

		const candidates: { node: string; degree: number; box: LabelBox }[] = [];
		graph.forEachNode((node, attributes) => {
			const data = renderer.getNodeDisplayData(node);
			if (!data?.label || data.hidden) return;
			const size = renderer.scaleSize(data.size);
			if (attributes.tier !== "large" && size < settings.labelRenderedSizeThreshold) return;
			const { x, y } = renderer.framedGraphToViewport(data);
			// A label Sigma never draws must take no room
			if (x < reach.left || x > reach.right || y < reach.top || y > reach.bottom) return;
			let labelWidth = this.labelWidths.get(node);
			if (labelWidth === undefined) {
				labelWidth = textWidth(context, typesetLabel(data.label, attributes.tier, settings));
				this.labelWidths.set(node, labelWidth);
			}
			const box = labelBox(labelWidth, 1, x, labelTop({ y, size }), settings);
			if (!overlaps(box, view)) return;
			candidates.push({ node, degree: graph.degreeWithoutSelfLoops(node), box });
		});
		candidates.sort((a, b) => b.degree - a.degree || (a.node < b.node ? -1 : 1));

		const atRest = placeApart(candidates, []);
		if (hovered === null) return atRest;
		const neighbours = candidates.filter(
			({ node }) =>
				atRest.has(node) && node !== hovered.node && graph.areNeighbors(node, hovered.node),
		);
		const data = renderer.getNodeDisplayData(hovered.node);
		if (data === undefined) return placeApart(neighbours, []);
		const { x, y } = renderer.framedGraphToViewport(data);
		const lines = hoverLines(
			hovered.node,
			graph.getNodeAttributes(hovered.node),
			settings,
			localOriginOf(graph),
		);
		const top = labelTop({ y, size: renderer.scaleSize(data.size) });
		const hoverWidth = Math.max(...lines.map((line) => textWidth(context, line)));
		return placeApart(neighbours, [labelBox(hoverWidth, lines.length, x, top, settings)]);
	}

	private hover(node: string | null): void {
		// Sigma emits leaveNode for a finger that crossed off a node too, which we never hovered
		if (node === (this.hovered?.node ?? null)) return;
		if (this.container) this.container.style.cursor = node === null ? "default" : "pointer";
		const graph = this.graph;
		this.hovered =
			node === null || graph === null
				? null
				: { node, site: siteOf(graph.getNodeAttributes(node)) };
		// Moving between nodes emits leaveNode then enterNode, which share one scheduled render
		this.renderer?.refresh({ schedule: true });
	}
}

if (!customElements.get(GraphGarden.tagName)) {
	customElements.define(GraphGarden.tagName, GraphGarden);
}
