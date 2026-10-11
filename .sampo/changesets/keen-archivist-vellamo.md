---
cargo/graphgarden-core: minor
---

**⚠️ breaking change:** Changed the `ConfigRead`, `FileRead`, `InvalidBaseUrl`, `InvalidFriendUrl` and `HtmlParse` errors to named fields, added `Error::InvalidSelector` and removed `Error::FileWrite`. `ParseConfig::exclude` and `ParseConfig::exclude_selectors` are now `Vec<String>`. `extract_page(html, page_url, base_url, friends, exclude_selectors)` is replaced by `Extractor::new(base_url, friends, exclude_selectors)?.extract_page(html, page_url)`.
