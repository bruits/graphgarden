use std::path::Path;
use std::str::FromStr;

use serde::Deserialize;

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
        let content = std::fs::read_to_string(path)?;
        content.parse()
    }
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
}
