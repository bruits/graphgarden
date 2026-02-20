// Sigma references WebGL contexts at module load time.
// happy-dom does not provide WebGL, so we stub the globals to allow imports.
for (const name of ["WebGLRenderingContext", "WebGL2RenderingContext"]) {
	if (typeof (globalThis as Record<string, unknown>)[name] === "undefined") {
		(globalThis as Record<string, unknown>)[name] = class {};
	}
}
