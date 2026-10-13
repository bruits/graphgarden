// `?theme=light|dark` forces a colour scheme. `?capture` reads friends from the copies in
// `/captures/` and seeds the layout with `?seed=N`, so screenshots come out the same every time.
(() => {
	const params = new URLSearchParams(location.search);
	const theme = params.get("theme");
	if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
	if (!params.has("capture")) return;

	document.documentElement.dataset.capture = "";

	// mulberry32
	let seed = Number(params.get("seed") ?? 1);
	Math.random = () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};

	const live = window.fetch.bind(window);
	window.fetch = (input, init) => {
		const url = new URL(String(input), location.href);
		if (url.origin !== location.origin && url.pathname === "/.well-known/graphgarden.json") {
			return live(`/captures/${url.host}.json`, init);
		}
		return live(input, init);
	};
})();
