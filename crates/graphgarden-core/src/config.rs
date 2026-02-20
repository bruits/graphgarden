use std::path::Path;
use std::str::FromStr;

use serde::Deserialize;
use url::Url;

use crate::error::{Error, Result};

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Config {
    pub site: SiteConfig,
    #[serde(default)]
    pub friends: Vec<String>,
    #[serde(default)]
    pub output: OutputConfig,
    #[serde(default)]
    pub parse: ParseConfig,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct SiteConfig {
    pub base_url: String,
    pub title: String,
    pub description: Option<String>,
    pub language: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(default)]
pub struct OutputConfig {
    pub dir: String,
}

impl Default for OutputConfig {
    fn default() -> Self {
        Self {
            dir: String::from("./dist"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(default)]
pub struct ParseConfig {
    pub include: Vec<String>,
    pub exclude: Option<Vec<String>>,
    pub exclude_selectors: Option<Vec<String>>,
}

impl Default for ParseConfig {
    fn default() -> Self {
        Self {
            include: vec![String::from("**/*.html")],
            exclude: None,
            exclude_selectors: None,
        }
    }
}

impl Config {
    pub fn from_file(path: impl AsRef<Path>) -> Result<Config> {
        let path = path.as_ref();
        if !path.exists() {
            return Err(Error::ConfigNotFound(path.to_path_buf()));
        }
        let content = std::fs::read_to_string(path).map_err(Error::ConfigRead)?;
        content.parse()
    }

    /// Validates the parsed config: checks that `base_url` is a well-formed
    /// HTTP(S) URL with a trailing slash, that `output.dir` exists as a
    /// directory, and that every friend URL is a valid HTTP(S) URL.
    pub fn validate(&self) -> Result<()> {
        validate_base_url(&self.site.base_url)?;

        let output_dir = Path::new(&self.output.dir);
        if !output_dir.is_dir() {
            return Err(Error::OutputDirNotFound(output_dir.to_path_buf()));
        }

        for friend in &self.friends {
            validate_friend_url(friend)?;
        }

        Ok(())
    }
}

/// Validates that a URL is a well-formed HTTP(S) URL.
fn validate_http_url(raw: &str) -> std::result::Result<Url, String> {
    let parsed = Url::parse(raw).map_err(|e| e.to_string())?;
    match parsed.scheme() {
        "http" | "https" => Ok(parsed),
        other => Err(format!("scheme must be http or https, got '{other}'")),
    }
}

/// Validates `base_url`: must be a well-formed HTTP(S) URL ending with `/`.
fn validate_base_url(raw: &str) -> Result<()> {
    validate_http_url(raw).map_err(|reason| Error::InvalidBaseUrl(raw.to_owned(), reason))?;

    if !raw.ends_with('/') {
        return Err(Error::InvalidBaseUrl(
            raw.to_owned(),
            String::from("must end with a trailing slash"),
        ));
    }

    Ok(())
}

/// Validates a friend URL: must be a well-formed HTTP(S) URL.
fn validate_friend_url(raw: &str) -> Result<()> {
    validate_http_url(raw).map_err(|reason| Error::InvalidFriendUrl(raw.to_owned(), reason))?;
    Ok(())
}

impl FromStr for Config {
    type Err = Error;

    fn from_str(s: &str) -> Result<Config> {
        let config: Config = toml::from_str(s)?;
        Ok(config)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{OutputConfig, ParseConfig, SiteConfig};

    /// Helper to build a config with the given base_url, output dir, and friends.
    fn test_config(base_url: &str, output_dir: &str, friends: Vec<String>) -> Config {
        Config {
            site: SiteConfig {
                base_url: String::from(base_url),
                title: String::from("Test"),
                description: None,
                language: None,
            },
            friends,
            output: OutputConfig {
                dir: String::from(output_dir),
            },
            parse: ParseConfig::default(),
        }
    }

    #[test]
    fn parse_full_config() {
        let toml = r#"
            friends = [
                "https://bob.dev/",
                "https://carol.dev/",
            ]

            [site]
            base_url = "https://alice.dev/"
            title = "Alice's Garden"
            description = "A blog about gardening"
            language = "en"

            [output]
            dir = "./public"

            [parse]
            include = ["**/*.html", "**/*.htm"]
            exclude = ["admin/**"]
            exclude_selectors = ["header", "footer", "nav"]
        "#;

        let config = Config::from_str(toml).expect("valid config should parse");

        assert_eq!(config.site.base_url, "https://alice.dev/");
        assert_eq!(config.site.title, "Alice's Garden");
        assert_eq!(
            config.site.description.as_deref(),
            Some("A blog about gardening")
        );
        assert_eq!(config.site.language.as_deref(), Some("en"));
        assert_eq!(
            config.friends,
            vec!["https://bob.dev/", "https://carol.dev/"]
        );
        assert_eq!(config.output.dir, "./public");
        assert_eq!(config.parse.include, vec!["**/*.html", "**/*.htm"]);
        assert_eq!(config.parse.exclude, Some(vec!["admin/**".to_owned()]));
        assert_eq!(
            config.parse.exclude_selectors,
            Some(vec![
                "header".to_owned(),
                "footer".to_owned(),
                "nav".to_owned(),
            ])
        );
    }

    #[test]
    fn parse_minimal_config_applies_defaults() {
        let toml = r#"
            [site]
            base_url = "https://example.com/"
            title = "My Site"
        "#;

        let config = Config::from_str(toml).expect("minimal config should parse");

        assert_eq!(config.site.base_url, "https://example.com/");
        assert_eq!(config.site.title, "My Site");
        assert_eq!(config.site.description, None);
        assert_eq!(config.site.language, None);
        assert!(config.friends.is_empty());
        assert_eq!(config.output.dir, "./dist");
        assert_eq!(config.parse.include, vec!["**/*.html"]);
        assert_eq!(config.parse.exclude, None);
        assert_eq!(config.parse.exclude_selectors, None);
    }

    #[test]
    fn parse_missing_site_section_errors() {
        let toml = r#"
            friends = ["https://bob.dev/"]
        "#;

        let result = Config::from_str(toml);
        assert!(result.is_err());
    }

    #[test]
    fn parse_missing_base_url_errors() {
        let toml = r#"
            [site]
            title = "My Site"
        "#;

        let result = Config::from_str(toml);
        assert!(result.is_err());
    }

    #[test]
    fn parse_missing_title_errors() {
        let toml = r#"
            [site]
            base_url = "https://example.com/"
        "#;

        let result = Config::from_str(toml);
        assert!(result.is_err());
    }

    #[test]
    fn from_file_missing_path_returns_config_not_found() {
        let result = Config::from_file("does_not_exist.toml");
        assert!(matches!(
            result,
            Err(crate::error::Error::ConfigNotFound(_))
        ));
    }

    // ---- validate() tests ----

    #[test]
    fn validate_accepts_valid_config() {
        let tmp = tempfile::TempDir::new().unwrap();
        let config = test_config(
            "https://alice.dev/",
            tmp.path().to_str().unwrap(),
            vec![String::from("https://bob.dev/")],
        );
        config
            .validate()
            .expect("valid config should pass validation");
    }

    #[test]
    fn validate_rejects_non_url_base_url() {
        let tmp = tempfile::TempDir::new().unwrap();
        let config = test_config("not a url", tmp.path().to_str().unwrap(), vec![]);
        let err = config.validate().unwrap_err();
        assert!(matches!(err, Error::InvalidBaseUrl(..)));
    }

    #[test]
    fn validate_rejects_non_http_base_url() {
        let tmp = tempfile::TempDir::new().unwrap();
        let config = test_config("ftp://alice.dev/", tmp.path().to_str().unwrap(), vec![]);
        let err = config.validate().unwrap_err();
        assert!(matches!(err, Error::InvalidBaseUrl(_, ref reason) if reason.contains("http")),);
    }

    #[test]
    fn validate_rejects_base_url_without_trailing_slash() {
        let tmp = tempfile::TempDir::new().unwrap();
        let config = test_config("https://alice.dev", tmp.path().to_str().unwrap(), vec![]);
        let err = config.validate().unwrap_err();
        assert!(
            matches!(err, Error::InvalidBaseUrl(_, ref reason) if reason.contains("trailing slash")),
        );
    }

    #[test]
    fn validate_rejects_missing_output_dir() {
        let config = test_config(
            "https://alice.dev/",
            "/tmp/does_not_exist_graphgarden_test",
            vec![],
        );
        let err = config.validate().unwrap_err();
        assert!(matches!(err, Error::OutputDirNotFound(_)));
    }

    #[test]
    fn validate_rejects_invalid_friend_url() {
        let tmp = tempfile::TempDir::new().unwrap();
        let config = test_config(
            "https://alice.dev/",
            tmp.path().to_str().unwrap(),
            vec![String::from("not a url")],
        );
        let err = config.validate().unwrap_err();
        assert!(matches!(err, Error::InvalidFriendUrl(..)));
    }

    #[test]
    fn validate_rejects_non_http_friend_url() {
        let tmp = tempfile::TempDir::new().unwrap();
        let config = test_config(
            "https://alice.dev/",
            tmp.path().to_str().unwrap(),
            vec![String::from("ftp://bob.dev/")],
        );
        let err = config.validate().unwrap_err();
        assert!(matches!(err, Error::InvalidFriendUrl(_, ref reason) if reason.contains("http")),);
    }
}
