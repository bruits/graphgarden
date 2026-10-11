use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

pub use graphgarden_protocol::PROTOCOL_VERSION;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Node {
    /// Path of the page on the site, e.g. `/about/`.
    pub url: String,
    /// Page title, or its URL when the page has none.
    pub title: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EdgeType {
    Internal,
    Friend,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Edge {
    /// Path of the linking page, always a [`Node`] URL.
    pub source: String,
    /// Path of the linked page for `internal` edges, absolute URL for `friend` edges.
    pub target: String,
    #[serde(rename = "type")]
    pub edge_type: EdgeType,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SiteMetadata {
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// BCP 47 language tag, e.g. `en`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
}

/// The public file served at `/.well-known/graphgarden.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PublicFile {
    pub version: String,
    /// ISO 8601 UTC timestamp of generation.
    pub generated_at: String,
    /// Site origin with a trailing slash, e.g. `https://alice.dev/`.
    pub base_url: String,
    pub site: SiteMetadata,
    /// Declared friend origins, absent from files before protocol 0.2.0.
    #[serde(default)]
    pub friends: Vec<String>,
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
}

impl PublicFile {
    /// Serializes the file as pretty-printed JSON.
    ///
    /// # Errors
    ///
    /// Returns [`Error::JsonSerialize`] if serialization fails.
    pub fn to_json(&self) -> Result<String> {
        serde_json::to_string_pretty(self).map_err(Error::JsonSerialize)
    }

    /// Parses a public file from JSON.
    ///
    /// # Errors
    ///
    /// Returns [`Error::JsonDeserialize`] if the input is not valid JSON for this schema.
    pub fn from_json(s: &str) -> Result<Self> {
        serde_json::from_str(s).map_err(Error::JsonDeserialize)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_the_wire_format() {
        let file = PublicFile {
            version: String::from("0.2.0"),
            generated_at: String::from("2026-02-17T12:00:00Z"),
            base_url: String::from("https://alice.dev/"),
            site: SiteMetadata {
                title: String::from("Alice's Garden"),
                description: None,
                language: None,
            },
            friends: vec![String::from("https://bob.dev/")],
            nodes: vec![Node {
                url: String::from("/"),
                title: String::from("Home"),
            }],
            edges: vec![Edge {
                source: String::from("/"),
                target: String::from("https://bob.dev/"),
                edge_type: EdgeType::Friend,
            }],
        };

        let json = file.to_json().unwrap();

        let value: serde_json::Value = serde_json::from_str(&json).unwrap();
        let expected = serde_json::json!({
            "version": "0.2.0",
            "generated_at": "2026-02-17T12:00:00Z",
            "base_url": "https://alice.dev/",
            "site": { "title": "Alice's Garden" },
            "friends": ["https://bob.dev/"],
            "nodes": [{ "url": "/", "title": "Home" }],
            "edges": [{ "source": "/", "target": "https://bob.dev/", "type": "friend" }]
        });
        assert_eq!(value, expected);
        assert_eq!(PublicFile::from_json(&json).unwrap(), file);
    }

    #[test]
    fn protocol_public_file_example_deserializes() {
        let json = r#"{
            "version": "0.2.0",
            "generated_at": "2026-02-17T12:00:00Z",
            "base_url": "https://alice.dev/",
            "site": {
                "title": "Alice's Garden",
                "description": "A blog about …",
                "language": "en"
            },
            "friends": ["https://bob.dev/"],
            "nodes": [
                { "url": "/", "title": "Home" },
                { "url": "/about", "title": "About" },
                { "url": "/posts/hello", "title": "Hello World" }
            ],
            "edges": [
                { "source": "/", "target": "/about", "type": "internal" },
                { "source": "/", "target": "/posts/hello", "type": "internal" },
                { "source": "/about", "target": "https://bob.dev/", "type": "friend" }
            ]
        }"#;

        let public_file = PublicFile::from_json(json).expect("protocol example should deserialize");

        // The example's version is illustrative: PROTOCOL_VERSION is bumped on release
        assert_eq!(
            public_file.site.description.as_deref(),
            Some("A blog about …")
        );
        assert_eq!(public_file.site.language.as_deref(), Some("en"));
        assert_eq!(public_file.nodes.len(), 3);
        assert_eq!(public_file.edges[0].edge_type, EdgeType::Internal);
        assert_eq!(public_file.edges[2].edge_type, EdgeType::Friend);
    }

    #[test]
    fn public_file_without_friends_defaults_to_empty() {
        let json = r#"{
            "version": "0.1.0",
            "generated_at": "2026-02-17T12:00:00Z",
            "base_url": "https://alice.dev/",
            "site": { "title": "Alice's Garden" },
            "nodes": [{ "url": "/", "title": "Home" }],
            "edges": []
        }"#;

        let public_file =
            PublicFile::from_json(json).expect("0.1.0 file without friends should deserialize");

        assert!(public_file.friends.is_empty());
    }

    #[test]
    fn from_json_rejects_invalid_input() {
        let cases = [
            ("malformed json", "{not json"),
            ("missing fields", r#"{"version":"0.1.0"}"#),
            (
                "wrong field type",
                r#"{"version":"0.1.0","generated_at":"x","base_url":"x","site":{"title":"x"},"nodes":"nope","edges":[]}"#,
            ),
        ];
        for (label, json) in cases {
            let result = PublicFile::from_json(json);
            assert!(
                matches!(result, Err(Error::JsonDeserialize(_))),
                "{label}: expected JsonDeserialize, got {result:?}"
            );
        }
    }
}
