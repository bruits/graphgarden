import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"graphgarden-web": resolve(import.meta.dirname, "../packages/graphgarden-web/src/index.ts"),
		},
	},
	test: {
		environment: "happy-dom",
		testTimeout: 60_000,
		hookTimeout: 60_000,
	},
});
