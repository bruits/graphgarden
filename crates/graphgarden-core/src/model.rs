use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

pub use graphgarden_protocol::PROTOCOL_VERSION;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Node {
    pub url: String,
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
    pub source: String,
    pub target: String,
    #[serde(rename = "type")]
    pub edge_type: EdgeType,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SiteMetadata {
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
}

/// The public file served at `/.well-known/graphgarden.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PublicFile {
    pub version: String,
    pub generated_at: String,
    pub base_url: String,
    pub site: SiteMetadata,
    #[serde(default)]
    pub friends: Vec<String>,
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
}

impl PublicFile {
    pub fn to_json(&self) -> Result<String> {
        serde_json::to_string_pretty(self).map_err(Error::JsonSerialize)
    }

    pub fn from_json(s: &str) -> Result<Self> {
        serde_json::from_str(s).map_err(Error::JsonDeserialize)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_public_file() -> PublicFile {
        PublicFile {
            version: String::from(PROTOCOL_VERSION),
            generated_at: String::from("2026-02-17T12:00:00Z"),
            base_url: String::from("https://alice.dev/"),
            site: SiteMetadata {
                title: String::from("Alice's Garden"),
                description: Some(String::from("A blog about gardening")),
                language: Some(String::from("en")),
            },
            friends: vec![String::from("https://bob.dev/")],
            nodes: vec![
                Node {
                    url: String::from("/"),
                    title: String::from("Home"),
                },
                Node {
                    url: String::from("/about"),
                    title: String::from("About"),
                },
            ],
            edges: vec![
                Edge {
                    source: String::from("/"),
                    target: String::from("/about"),
                    edge_type: EdgeType::Internal,
                },
                Edge {
                    source: String::from("/about"),
                    target: String::from("https://bob.dev/"),
                    edge_type: EdgeType::Friend,
                },
            ],
        }
    }

    #[test]
    fn public_file_round_trip() {
        let original = sample_public_file();
        let json = original.to_json().expect("serialization should succeed");
        let restored = PublicFile::from_json(&json).expect("deserialization should succeed");
        assert_eq!(original, restored);
    }

    #[test]
    fn edge_type_serialization() {
        let internal_json =
            serde_json::to_string(&EdgeType::Internal).expect("serialization should succeed");
        assert_eq!(internal_json, r#""internal""#);

        let friend_json =
            serde_json::to_string(&EdgeType::Friend).expect("serialization should succeed");
        assert_eq!(friend_json, r#""friend""#);
    }

    #[test]
    fn edge_type_field_serializes_as_type() {
        let edge = Edge {
            source: String::from("/"),
            target: String::from("/about"),
            edge_type: EdgeType::Internal,
        };
        let json = serde_json::to_string(&edge).expect("serialization should succeed");
        assert!(json.contains(r#""type":"internal""#));
        assert!(!json.contains("edge_type"));
    }

    #[test]
    fn site_metadata_omits_none_fields() {
        let metadata = SiteMetadata {
            title: String::from("Test"),
            description: None,
            language: None,
        };
        let json = serde_json::to_string(&metadata).expect("serialization should succeed");
        assert!(!json.contains("description"));
        assert!(!json.contains("language"));
    }

    #[test]
    fn protocol_public_file_example_deserializes() {
        let json = r#"{
            "version": "0.1.0",
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

        assert_eq!(public_file.version, PROTOCOL_VERSION);
        assert_eq!(public_file.base_url, "https://alice.dev/");
        assert_eq!(public_file.site.title, "Alice's Garden");
        assert_eq!(public_file.nodes.len(), 3);
        assert_eq!(public_file.edges.len(), 3);
        assert_eq!(public_file.edges[2].edge_type, EdgeType::Friend);
    }

    #[test]
    fn public_file_without_friends_defaults_to_empty() {
        let json = r#"{
            "version": "0.1.0",
            "generated_at": "2026-02-17T12:00:00Z",
            "base_url": "https://alice.dev/",
            "site": {
                "title": "Alice's Garden",
                "description": "A blog about …",
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

        let public_file =
            PublicFile::from_json(json).expect("0.1.0 file without friends should deserialize");

        assert_eq!(public_file.friends, Vec::<String>::new());
    }

    #[test]
    fn from_json_rejects_malformed_json() {
        let result = PublicFile::from_json("{not json");

        assert!(result.is_err());
        assert!(
            matches!(result.unwrap_err(), Error::JsonDeserialize(_)),
            "expected JsonDeserialize error"
        );
    }

    #[test]
    fn from_json_rejects_missing_required_fields() {
        let result = PublicFile::from_json(r#"{"version":"0.1.0"}"#);

        assert!(result.is_err());
        assert!(
            matches!(result.unwrap_err(), Error::JsonDeserialize(_)),
            "expected JsonDeserialize error for missing fields"
        );
    }

    #[test]
    fn from_json_rejects_wrong_field_types() {
        let json = r#"{
            "version": "0.1.0",
            "generated_at": "2026-02-17T12:00:00Z",
            "base_url": "https://alice.dev/",
            "site": { "title": "Test" },
            "friends": [],
            "nodes": "not_an_array",
            "edges": []
        }"#;

        let result = PublicFile::from_json(json);

        assert!(result.is_err());
        assert!(
            matches!(result.unwrap_err(), Error::JsonDeserialize(_)),
            "expected JsonDeserialize error for wrong field types"
        );
    }
}
