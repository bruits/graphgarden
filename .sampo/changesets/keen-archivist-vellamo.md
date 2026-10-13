---
cargo/graphgarden-core: minor
---

**⚠️ breaking change:** Changed `extract_page` to `Extractor::new(base_url, friends, exclude_selectors)?.extract_page(html, page_url)`, and the `ParseConfig` exclusion lists to `Vec<String>`. Changed several `Error` variants to named fields, with a new `InvalidSelector`, no more `FileWrite`, and a `ConfigParse` that wraps the `toml` 1.x error.
