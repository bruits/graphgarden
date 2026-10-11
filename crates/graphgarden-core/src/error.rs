use std::path::PathBuf;

/// Errors that can occur in graphgarden-core operations.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("config file not found: {0}")]
    ConfigNotFound(PathBuf),

    #[error("failed to read config file {path}")]
    ConfigRead {
        path: PathBuf,
        source: std::io::Error,
    },

    #[error("failed to parse config")]
    ConfigParse(#[from] toml::de::Error),

    #[error("invalid base_url '{url}': {reason}")]
    InvalidBaseUrl { url: String, reason: String },

    #[error("invalid friend URL '{url}': {reason}")]
    InvalidFriendUrl { url: String, reason: String },

    #[error("invalid CSS selector '{selector}': {reason}")]
    InvalidSelector { selector: String, reason: String },

    #[error("invalid glob pattern")]
    GlobPattern(#[from] globset::Error),

    #[error("output directory does not exist: {0}")]
    OutputDirNotFound(PathBuf),

    #[error("directory walk failed")]
    DirectoryWalk(#[from] walkdir::Error),

    #[error("failed to read {path}")]
    FileRead {
        path: PathBuf,
        source: std::io::Error,
    },

    #[error("HTML parsing failed on {page}: {reason}")]
    HtmlParse {
        /// Page URL path, e.g. `/about/`.
        page: String,
        reason: String,
    },

    #[error("failed to serialize JSON")]
    JsonSerialize(#[source] serde_json::Error),

    #[error("failed to deserialize JSON")]
    JsonDeserialize(#[source] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, Error>;
