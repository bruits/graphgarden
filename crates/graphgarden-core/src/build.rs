use std::path::Path;

use globset::{Glob, GlobSet, GlobSetBuilder};
use jiff::Timestamp;
use walkdir::WalkDir;

use crate::config::Config;
use crate::error::{Error, Result};
use crate::extract::extract_page;
use crate::model::{self, PublicFile, SiteMetadata};

/// Walks the output directory, extracts links from HTML files, and assembles a [`PublicFile`].
pub fn build(config: &Config) -> Result<PublicFile> {
    let output_dir = Path::new(&config.output.dir);

    let include_set = compile_glob_set(&config.parse.include)?;
    let exclude_set = config
        .parse
        .exclude
        .as_ref()
        .map(|patterns| compile_glob_set(patterns))
        .transpose()?;

    let exclude_selectors: &[String] = config.parse.exclude_selectors.as_deref().unwrap_or(&[]);

    let mut nodes = Vec::new();
    let mut edges = Vec::new();

    for entry in WalkDir::new(output_dir) {
        let entry = entry?;
        if !entry.file_type().is_file() {
            continue;
        }

        let relative_path = entry
            .path()
            .strip_prefix(output_dir)
            .expect("walkdir entry should be under output_dir");

        // Normalize to forward slashes for cross-platform glob matching
        let normalized = relative_path.to_string_lossy().replace('\\', "/");

        if !include_set.is_match(&normalized) {
            continue;
        }
        if let Some(ref exc) = exclude_set
            && exc.is_match(&normalized)
        {
            continue;
        }

        let html = std::fs::read_to_string(entry.path())
            .map_err(|e| Error::FileRead(e, entry.path().to_path_buf()))?;
        let page_url = file_path_to_url(&normalized);

        let (node, page_edges) = extract_page(
            &html,
            &page_url,
            &config.site.base_url,
            &config.friends,
            exclude_selectors,
        )?;

        nodes.push(node);
        edges.extend(page_edges);
    }

    Ok(PublicFile {
        version: String::from(model::PROTOCOL_VERSION),
        generated_at: utc_timestamp(),
        base_url: config.site.base_url.clone(),
        site: SiteMetadata {
            title: config.site.title.clone(),
            description: config.site.description.clone(),
            language: config.site.language.clone(),
        },
        friends: config.friends.clone(),
        nodes,
        edges,
    })
}

fn compile_glob_set(patterns: &[String]) -> Result<GlobSet> {
    let mut builder = GlobSetBuilder::new();
    for pattern in patterns {
        builder.add(Glob::new(pattern)?);
    }
    Ok(builder.build()?)
}

/// Converts a file path (relative to the output directory) to a page URL.
///
/// `about/index.html` → `/about/`, `posts/hello.html` → `/posts/hello`,
/// `index.html` → `/`.
fn file_path_to_url(path: &str) -> String {
    let mut url = format!("/{path}");

    if url.ends_with("/index.html") {
        url.truncate(url.len() - "index.html".len());
        return url;
    }

    if url.ends_with(".html") {
        url.truncate(url.len() - ".html".len());
    }

    url
}

/// Returns the current UTC time formatted as ISO 8601 (`YYYY-MM-DDTHH:MM:SSZ`).
fn utc_timestamp() -> String {
    Timestamp::now().strftime("%Y-%m-%dT%H:%M:%SZ").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{Config, OutputConfig, ParseConfig, SiteConfig};
    use crate::model::EdgeType;
    use std::fs;
    use std::path::Path;
    use tempfile::TempDir;

    fn test_config(output_dir: &str) -> Config {
        Config {
            site: SiteConfig {
                base_url: String::from("https://alice.dev/"),
                title: String::from("Alice's Garden"),
                description: None,
                language: None,
            },
            friends: vec![String::from("https://bob.dev/")],
            output: OutputConfig {
                dir: String::from(output_dir),
            },
            parse: ParseConfig {
                include: vec![String::from("**/*.html")],
                exclude: None,
                exclude_selectors: None,
            },
        }
    }

    fn write_file(dir: &Path, relative: &str, content: &str) {
        let path = dir.join(relative);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, content).unwrap();
    }

    #[test]
    fn build_basic() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path();

        write_file(
            dir,
            "index.html",
            r#"<html><head><title>Home</title></head><body>
                <a href="/about/">About</a>
                <a href="https://bob.dev/">Bob</a>
            </body></html>"#,
        );
        write_file(
            dir,
            "about/index.html",
            r#"<html><head><title>About</title></head><body>
                <a href="/">Home</a>
            </body></html>"#,
        );

        let config = test_config(dir.to_str().unwrap());
        let result = build(&config).unwrap();

        assert_eq!(result.version, crate::model::PROTOCOL_VERSION);
        assert_eq!(result.base_url, "https://alice.dev/");
        assert_eq!(result.site.title, "Alice's Garden");
        assert_eq!(result.friends, vec!["https://bob.dev/"]);
        assert_eq!(result.nodes.len(), 2);
        assert!(
            result
                .nodes
                .iter()
                .any(|n| n.url == "/" && n.title == "Home")
        );
        assert!(
            result
                .nodes
                .iter()
                .any(|n| n.url == "/about/" && n.title == "About")
        );

        assert_eq!(result.edges.len(), 3);
        assert!(result.edges.iter().any(|e| e.source == "/"
            && e.target == "/about/"
            && e.edge_type == EdgeType::Internal));
        assert!(result.edges.iter().any(|e| e.source == "/"
            && e.target == "https://bob.dev/"
            && e.edge_type == EdgeType::Friend));
        assert!(result.edges.iter().any(|e| e.source == "/about/"
            && e.target == "/"
            && e.edge_type == EdgeType::Internal));
    }

    #[test]
    fn build_exclude_patterns() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path();

        write_file(
            dir,
            "index.html",
            "<html><head><title>Home</title></head><body></body></html>",
        );
        write_file(
            dir,
            "admin/index.html",
            "<html><head><title>Admin</title></head><body></body></html>",
        );

        let mut config = test_config(dir.to_str().unwrap());
        config.parse.exclude = Some(vec![String::from("admin/**")]);

        let result = build(&config).unwrap();

        assert_eq!(result.nodes.len(), 1);
        assert_eq!(result.nodes[0].url, "/");
        assert_eq!(result.nodes[0].title, "Home");
    }

    #[test]
    fn build_exclude_selectors() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path();

        write_file(
            dir,
            "index.html",
            r#"<html><head><title>Home</title></head><body>
                <nav><a href="/hidden">Hidden</a></nav>
                <main><a href="/visible">Visible</a></main>
            </body></html>"#,
        );

        let mut config = test_config(dir.to_str().unwrap());
        config.parse.exclude_selectors = Some(vec![String::from("nav")]);

        let result = build(&config).unwrap();

        assert_eq!(result.edges.len(), 1);
        assert_eq!(result.edges[0].target, "/visible");
    }

    #[test]
    fn file_path_to_url_converts_index() {
        assert_eq!(file_path_to_url("index.html"), "/");
    }

    #[test]
    fn file_path_to_url_converts_nested_index() {
        assert_eq!(file_path_to_url("about/index.html"), "/about/");
    }

    #[test]
    fn file_path_to_url_converts_named_page() {
        assert_eq!(file_path_to_url("posts/hello.html"), "/posts/hello");
    }

    #[test]
    fn build_empty_output_dir() {
        let tmp = TempDir::new().unwrap();

        let config = test_config(tmp.path().to_str().unwrap());
        let result = build(&config).unwrap();

        assert!(result.nodes.is_empty());
        assert!(result.edges.is_empty());
    }

    #[test]
    fn build_skips_non_html_files() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path();

        write_file(dir, "style.css", "body { color: red; }");
        write_file(dir, "script.js", "console.log('hi');");
        write_file(dir, "image.png", "fake png data");
        write_file(
            dir,
            "index.html",
            "<html><head><title>Home</title></head><body></body></html>",
        );

        let config = test_config(dir.to_str().unwrap());
        let result = build(&config).unwrap();

        assert_eq!(result.nodes.len(), 1);
        assert_eq!(result.nodes[0].url, "/");
        assert_eq!(result.nodes[0].title, "Home");
    }

    #[test]
    fn build_only_non_html_files() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path();

        write_file(dir, "style.css", "body { color: red; }");
        write_file(dir, "script.js", "console.log('hi');");
        write_file(dir, "data.txt", "some text");

        let config = test_config(dir.to_str().unwrap());
        let result = build(&config).unwrap();

        assert!(result.nodes.is_empty());
        assert!(result.edges.is_empty());
    }
}
