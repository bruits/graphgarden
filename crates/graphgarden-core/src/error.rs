use std::path::PathBuf;

/// Errors that can occur in graphgarden-core operations.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("config file not found: {0}")]
    ConfigNotFound(PathBuf),

    #[error("failed to read config file: {0}")]
    ConfigRead(#[from] std::io::Error),

    #[error("failed to parse config: {0}")]
    ConfigParse(#[from] toml::de::Error),

    #[error("failed to serialize JSON: {0}")]
    JsonSerialize(#[source] serde_json::Error),

    #[error("failed to deserialize JSON: {0}")]
    JsonDeserialize(#[source] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, Error>;
