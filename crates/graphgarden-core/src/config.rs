use std::path::Path;
use std::str::FromStr;

use globset::{Glob, GlobSet, GlobSetBuilder};
use lol_html::Selector;
use serde::Deserialize;
use url::Url;

use crate::error::{Error, Result};

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Config {
    pub site: SiteConfig,
    /// Friend site origins, e.g. `https://bob.dev/`.
    #[serde(default)]
    pub friends: Vec<String>,
    #[serde(default)]
    pub output: OutputConfig,
    #[serde(default)]
    pub parse: ParseConfig,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct SiteConfig {
    /// Site origin with a trailing slash and no path, e.g. `https://alice.dev/`.
    pub base_url: String,
    pub title: String,
    pub description: Option<String>,
    /// BCP 47 language tag, e.g. `en`.
    pub language: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(default)]
pub struct OutputConfig {
    /// Directory containing the built HTML, relative to the working directory.
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
    /// Globs of files to parse, relative to `output.dir`.
    pub include: Vec<String>,
    /// Globs of files to skip even when they match `include`.
    pub exclude: Vec<String>,
    /// CSS selectors whose links are ignored.
    ///
    /// A matched element needs an explicit end tag. An unclosed `<p class="skip">` excludes the
    /// rest of the page.
    pub exclude_selectors: Vec<String>,
}

impl Default for ParseConfig {
    fn default() -> Self {
        Self {
            include: vec![String::from("**/*.html")],
            exclude: Vec::new(),
            exclude_selectors: Vec::new(),
        }
    }
}

impl Config {
    /// Reads and parses a `graphgarden.toml` file.
    ///
    /// # Errors
    ///
    /// Returns [`Error::ConfigNotFound`] if the file does not exist, [`Error::ConfigRead`] if it
    /// cannot be read, and [`Error::ConfigParse`] if it is not valid TOML for this schema.
    pub fn from_file(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        let content = std::fs::read_to_string(path).map_err(|source| {
            if source.kind() == std::io::ErrorKind::NotFound {
                Error::ConfigNotFound(path.to_path_buf())
            } else {
                Error::ConfigRead {
                    path: path.to_path_buf(),
                    source,
                }
            }
        })?;
        content.parse()
    }

    /// Checks every user-supplied value. [`build`](crate::build::build) does not call it.
    ///
    /// # Errors
    ///
    /// Returns the first failing check as [`Error::InvalidBaseUrl`], [`Error::InvalidFriendUrl`],
    /// [`Error::OutputDirNotFound`], [`Error::GlobPattern`], or [`Error::InvalidSelector`].
    pub fn validate(&self) -> Result<()> {
        parse_base_url(&self.site.base_url)?;

        let output_dir = Path::new(&self.output.dir);
        if !output_dir.is_dir() {
            return Err(Error::OutputDirNotFound(output_dir.to_path_buf()));
        }

        parse_friends(&self.friends)?;
        compile_globs(&self.parse.include)?;
        compile_globs(&self.parse.exclude)?;
        for selector in &self.parse.exclude_selectors {
            parse_selector(selector)?;
        }

        Ok(())
    }
}

impl FromStr for Config {
    type Err = Error;

    fn from_str(s: &str) -> Result<Self> {
        Ok(toml::from_str(s)?)
    }
}

pub(crate) fn parse_base_url(raw: &str) -> Result<Url> {
    parse_origin(raw).map_err(|reason| Error::InvalidBaseUrl {
        url: raw.to_owned(),
        reason,
    })
}

pub(crate) fn parse_friends(raw: &[String]) -> Result<Vec<Url>> {
    raw.iter()
        .map(|friend| {
            parse_origin(friend).map_err(|reason| Error::InvalidFriendUrl {
                url: friend.to_owned(),
                reason,
            })
        })
        .collect()
}

/// A site is scoped to its origin because its file lives under `/.well-known/`.
fn parse_origin(raw: &str) -> std::result::Result<Url, String> {
    let parsed = Url::parse(raw).map_err(|e| e.to_string())?;
    match parsed.scheme() {
        "http" | "https" => {}
        other => return Err(format!("scheme must be http or https, got '{other}'")),
    }
    if parsed.host_str().is_none() {
        return Err(String::from("must have a host"));
    }
    if !raw.ends_with('/') {
        return Err(String::from("must end with a trailing slash"));
    }
    if parsed.path() != "/" || parsed.query().is_some() || parsed.fragment().is_some() {
        return Err(String::from(
            "must be a site origin such as https://alice.dev/, without a path, query or fragment",
        ));
    }
    Ok(parsed)
}

/// An empty list matches nothing.
pub(crate) fn compile_globs(patterns: &[String]) -> Result<GlobSet> {
    let mut builder = GlobSetBuilder::new();
    for pattern in patterns {
        builder.add(Glob::new(pattern)?);
    }
    Ok(builder.build()?)
}

pub(crate) fn parse_selector(raw: &str) -> Result<Selector> {
    raw.parse::<Selector>()
        .map_err(|err| Error::InvalidSelector {
            selector: raw.to_owned(),
            reason: err.to_string(),
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_config(base_url: &str, output_dir: &Path) -> Config {
        Config {
            site: SiteConfig {
                base_url: String::from(base_url),
                title: String::from("Test"),
                description: None,
                language: None,
            },
            friends: Vec::new(),
            output: OutputConfig {
                dir: output_dir.to_str().unwrap().to_owned(),
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
        assert_eq!(config.parse.exclude, vec!["admin/**"]);
        assert_eq!(
            config.parse.exclude_selectors,
            vec!["header", "footer", "nav"]
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

        assert_eq!(config.site.description, None);
        assert_eq!(config.site.language, None);
        assert!(config.friends.is_empty());
        assert_eq!(config.output.dir, "./dist");
        assert_eq!(config.parse.include, vec!["**/*.html"]);
        assert!(config.parse.exclude.is_empty());
        assert!(config.parse.exclude_selectors.is_empty());
    }

    #[test]
    fn parse_rejects_missing_required_fields_and_malformed_toml() {
        let cases = [
            ("missing [site]", "friends = [\"https://bob.dev/\"]"),
            ("missing base_url", "[site]\ntitle = \"My Site\""),
            (
                "missing title",
                "[site]\nbase_url = \"https://example.com/\"",
            ),
            ("malformed toml", "[site\nbase_url = "),
        ];

        for (label, toml) in cases {
            let result = Config::from_str(toml);
            assert!(
                matches!(result, Err(Error::ConfigParse(_))),
                "{label}: expected ConfigParse, got {result:?}"
            );
        }
    }

    #[test]
    fn from_file_reads_config() {
        let tmp = tempfile::TempDir::new().unwrap();
        let path = tmp.path().join("graphgarden.toml");
        std::fs::write(
            &path,
            "[site]\nbase_url = \"https://alice.dev/\"\ntitle = \"Alice\"",
        )
        .unwrap();

        let config = Config::from_file(&path).expect("config file should load");

        assert_eq!(config.site.title, "Alice");
    }

    #[test]
    fn from_file_missing_path_returns_config_not_found() {
        let tmp = tempfile::TempDir::new().unwrap();
        let result = Config::from_file(tmp.path().join("does_not_exist.toml"));
        assert!(matches!(result, Err(Error::ConfigNotFound(_))));
    }

    #[test]
    fn validate_accepts_full_config() {
        let tmp = tempfile::TempDir::new().unwrap();
        let mut config = test_config("https://alice.dev/", tmp.path());
        config.friends = vec![
            String::from("https://bob.dev/"),
            String::from("http://carol.dev:8080/"),
        ];
        config.parse.exclude = vec![String::from("admin/**")];
        config.parse.exclude_selectors = vec![String::from("nav"), String::from(".skip a")];

        config
            .validate()
            .expect("valid config should pass validation");
    }

    #[test]
    fn validate_rejects_base_urls_that_are_not_origins() {
        let tmp = tempfile::TempDir::new().unwrap();
        let cases = [
            ("not a url", "relative URL"),
            ("ftp://alice.dev/", "scheme must be http or https"),
            ("https://alice.dev", "trailing slash"),
            ("https://alice.dev/garden/", "without a path"),
            ("https://alice.dev/?x=1/", "without a path"),
        ];

        for (base_url, expected_reason) in cases {
            let err = test_config(base_url, tmp.path()).validate().unwrap_err();
            match err {
                Error::InvalidBaseUrl { url, reason } => {
                    assert_eq!(url, base_url);
                    assert!(
                        reason.contains(expected_reason),
                        "{base_url}: got reason '{reason}'"
                    );
                }
                other => panic!("{base_url}: expected InvalidBaseUrl, got {other:?}"),
            }
        }
    }

    #[test]
    fn validate_rejects_friends_that_are_not_origins() {
        let tmp = tempfile::TempDir::new().unwrap();
        let cases = [
            "not a url",
            "ftp://bob.dev/",
            "https://bob.dev",
            "https://bob.dev/blog/",
        ];

        for friend in cases {
            let mut config = test_config("https://alice.dev/", tmp.path());
            config.friends = vec![String::from(friend)];
            let err = config.validate().unwrap_err();
            assert!(
                matches!(err, Error::InvalidFriendUrl { ref url, .. } if url == friend),
                "{friend}: expected InvalidFriendUrl, got {err:?}"
            );
        }
    }

    #[test]
    fn validate_rejects_missing_output_dir() {
        let tmp = tempfile::TempDir::new().unwrap();
        let config = test_config("https://alice.dev/", &tmp.path().join("missing"));
        let err = config.validate().unwrap_err();
        assert!(matches!(err, Error::OutputDirNotFound(_)));
    }

    #[test]
    fn validate_rejects_invalid_glob() {
        let tmp = tempfile::TempDir::new().unwrap();
        let mut config = test_config("https://alice.dev/", tmp.path());
        config.parse.include = vec![String::from("**/[unclosed")];
        let err = config.validate().unwrap_err();
        assert!(matches!(err, Error::GlobPattern(_)), "got {err:?}");
    }

    #[test]
    fn validate_rejects_invalid_css_selector() {
        let tmp = tempfile::TempDir::new().unwrap();
        let mut config = test_config("https://alice.dev/", tmp.path());
        config.parse.exclude_selectors = vec![String::from("a]")];
        let err = config.validate().unwrap_err();
        assert!(
            matches!(err, Error::InvalidSelector { ref selector, .. } if selector == "a]"),
            "got {err:?}"
        );
    }
}
