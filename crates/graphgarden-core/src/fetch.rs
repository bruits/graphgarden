//! Fetch a friend's `graphgarden.json` over HTTP with timestamp-based caching.

use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::model::PublicFile;

/// Outcome of fetching a friend's `graphgarden.json`.
#[derive(Debug)]
pub enum FetchOutcome {
    /// The remote file was fetched and deserialized successfully.
    Fresh(PublicFile),
    /// The cached `generated_at` matches — no update needed.
    Cached,
}

/// In-memory cache mapping URLs to their last-seen `generated_at` timestamp.
///
/// Can be persisted to disk as JSON via [`FetchCache::load`] and [`FetchCache::save`].
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FetchCache {
    entries: HashMap<String, String>,
}

impl FetchCache {
    /// Creates an empty cache.
    pub fn new() -> Self {
        Self {
            entries: HashMap::new(),
        }
    }

    /// Loads a cache from a JSON file. Returns an empty cache if the file does not exist.
    pub fn load(path: &Path) -> Result<Self> {
        match fs::read_to_string(path) {
            Ok(contents) => serde_json::from_str(&contents).map_err(Error::JsonDeserialize),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Self::new()),
            Err(e) => Err(Error::FileRead(e, path.to_path_buf())),
        }
    }

    /// Saves the cache to a JSON file.
    pub fn save(&self, path: &Path) -> Result<()> {
        let json = serde_json::to_string_pretty(self).map_err(Error::JsonSerialize)?;
        fs::write(path, json).map_err(|e| Error::FileWrite(e, path.to_path_buf()))
    }
}

impl Default for FetchCache {
    fn default() -> Self {
        Self::new()
    }
}

/// Constructs the `graphgarden.json` URL from a base URL.
fn graphgarden_url(base_url: &str) -> String {
    if base_url.ends_with('/') {
        format!("{base_url}graphgarden.json")
    } else {
        format!("{base_url}/graphgarden.json")
    }
}

/// Processes a fetched response body: deserializes and checks against the cache.
///
/// Separated from HTTP transport to enable testing without network access.
pub fn process_response(body: &str, url: &str, cache: &mut FetchCache) -> Result<FetchOutcome> {
    let public_file = PublicFile::from_json(body)?;

    if let Some(cached_timestamp) = cache.entries.get(url)
        && *cached_timestamp == public_file.generated_at
    {
        return Ok(FetchOutcome::Cached);
    }

    cache
        .entries
        .insert(url.to_owned(), public_file.generated_at.clone());

    Ok(FetchOutcome::Fresh(public_file))
}

/// Fetches a friend's `graphgarden.json` over HTTP, with timestamp-based caching.
///
/// Takes a friend's base URL (e.g. `https://bob.dev/`), appends `graphgarden.json`,
/// fetches it via HTTP GET, and returns the deserialized [`PublicFile`] or indicates
/// the cached version is still current.
pub fn fetch_friend(base_url: &str, cache: &mut FetchCache) -> Result<FetchOutcome> {
    let url = graphgarden_url(base_url);

    let user_agent = format!("graphgarden/{}", env!("CARGO_PKG_VERSION"));

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent(&user_agent)
        .build()
        .map_err(|e| Error::HttpRequest(e.to_string()))?;

    let body = client
        .get(&url)
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| Error::HttpRequest(e.to_string()))?
        .text()
        .map_err(|e| Error::HttpBody(e.to_string()))?;

    process_response(&body, &url, cache)
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE_JSON: &str = r#"{
        "version": "0.1.0",
        "generated_at": "2026-02-17T12:00:00Z",
        "base_url": "https://bob.dev/",
        "site": {
            "title": "Bob's Garden",
            "description": "A blog about graphs",
            "language": "en"
        },
        "nodes": [
            { "url": "/", "title": "Home" },
            { "url": "/about", "title": "About" }
        ],
        "edges": [
            { "source": "/", "target": "/about", "type": "internal" }
        ]
    }"#;

    #[test]
    fn cache_miss_empty_cache() {
        let mut cache = FetchCache::new();
        let url = "https://bob.dev/graphgarden.json";

        let outcome = process_response(FIXTURE_JSON, url, &mut cache).unwrap();

        assert!(matches!(outcome, FetchOutcome::Fresh(_)));
        assert_eq!(cache.entries.get(url).unwrap(), "2026-02-17T12:00:00Z");
    }

    #[test]
    fn cache_hit_same_generated_at() {
        let mut cache = FetchCache::new();
        let url = "https://bob.dev/graphgarden.json";

        // First fetch populates the cache
        process_response(FIXTURE_JSON, url, &mut cache).unwrap();

        // Second fetch with same content triggers cache hit
        let outcome = process_response(FIXTURE_JSON, url, &mut cache).unwrap();
        assert!(matches!(outcome, FetchOutcome::Cached));
    }

    #[test]
    fn cache_miss_different_generated_at() {
        let mut cache = FetchCache::new();
        let url = "https://bob.dev/graphgarden.json";

        process_response(FIXTURE_JSON, url, &mut cache).unwrap();

        let updated_json = FIXTURE_JSON.replace("2026-02-17T12:00:00Z", "2026-02-18T08:00:00Z");
        let outcome = process_response(&updated_json, url, &mut cache).unwrap();

        assert!(matches!(outcome, FetchOutcome::Fresh(_)));
        assert_eq!(cache.entries.get(url).unwrap(), "2026-02-18T08:00:00Z");
    }

    #[test]
    fn invalid_json_returns_error() {
        let mut cache = FetchCache::new();
        let url = "https://bob.dev/graphgarden.json";

        let result = process_response("not valid json", url, &mut cache);
        assert!(result.is_err());
    }

    #[test]
    fn cache_save_load_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let cache_path = dir.path().join("cache.json");

        let mut cache = FetchCache::new();
        cache.entries.insert(
            "https://bob.dev/graphgarden.json".to_owned(),
            "2026-02-17T12:00:00Z".to_owned(),
        );
        cache.save(&cache_path).unwrap();

        let loaded = FetchCache::load(&cache_path).unwrap();
        assert_eq!(
            loaded
                .entries
                .get("https://bob.dev/graphgarden.json")
                .unwrap(),
            "2026-02-17T12:00:00Z"
        );
    }

    #[test]
    fn cache_load_missing_file_returns_empty() {
        let dir = tempfile::tempdir().unwrap();
        let cache_path = dir.path().join("nonexistent.json");

        let cache = FetchCache::load(&cache_path).unwrap();
        assert!(cache.entries.is_empty());
    }

    #[test]
    fn url_construction_with_trailing_slash() {
        assert_eq!(
            graphgarden_url("https://bob.dev/"),
            "https://bob.dev/graphgarden.json"
        );
    }

    #[test]
    fn url_construction_without_trailing_slash() {
        assert_eq!(
            graphgarden_url("https://bob.dev"),
            "https://bob.dev/graphgarden.json"
        );
    }

    #[test]
    fn fresh_outcome_contains_deserialized_data() {
        let mut cache = FetchCache::new();
        let url = "https://bob.dev/graphgarden.json";

        let outcome = process_response(FIXTURE_JSON, url, &mut cache).unwrap();

        match outcome {
            FetchOutcome::Fresh(public_file) => {
                assert_eq!(public_file.version, crate::model::PROTOCOL_VERSION);
                assert_eq!(public_file.base_url, "https://bob.dev/");
                assert_eq!(public_file.site.title, "Bob's Garden");
                assert_eq!(public_file.nodes.len(), 2);
                assert_eq!(public_file.edges.len(), 1);
            }
            FetchOutcome::Cached => panic!("expected Fresh, got Cached"),
        }
    }
}
