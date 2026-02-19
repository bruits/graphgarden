/**
 * `<graph-garden>` custom element — renders an interactive node graph
 * from a site's `graphgarden.json` file.
 */
export class GraphGarden extends HTMLElement {
	static readonly tagName = "graph-garden" as const;

	connectedCallback(): void {
		// TODO: fetch graphgarden.json, build graph, render
	}

	disconnectedCallback(): void {
		// TODO: tear down rendering resources
	}
}

if (!customElements.get(GraphGarden.tagName)) {
	customElements.define(GraphGarden.tagName, GraphGarden);
}
