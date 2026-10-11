use std::collections::HashSet;
use std::path::Path;

use jiff::Timestamp;
use walkdir::WalkDir;

use crate::config::{self, Config};
use crate::error::{Error, Result};
use crate::extract::Extractor;
use crate::model::{self, EdgeType, PublicFile, SiteMetadata};

/// Walks `output.dir`, extracts links from every included HTML file, and assembles a [`PublicFile`].
///
/// Does not call [`Config::validate`].
///
/// # Errors
///
/// Returns the config errors of [`Config::validate`] for malformed URLs, globs or selectors,
/// [`Error::DirectoryWalk`] or [`Error::FileRead`] for filesystem failures, and
/// [`Error::HtmlParse`] if a page cannot be parsed.
pub fn build(config: &Config) -> Result<PublicFile> {
    let output_dir = Path::new(&config.output.dir);
    let extractor = Extractor::new(
        &config.site.base_url,
        &config.friends,
        &config.parse.exclude_selectors,
    )?;
    let include = config::compile_globs(&config.parse.include)?;
    let exclude = config::compile_globs(&config.parse.exclude)?;

    let mut nodes = Vec::new();
    let mut edges = Vec::new();

    for entry in WalkDir::new(output_dir).sort_by_file_name() {
        let entry = entry?;
        if !entry.file_type().is_file() {
            continue;
        }

        let relative_path = entry
            .path()
            .strip_prefix(output_dir)
            .expect("walkdir entry should be under output_dir");

        // Joined with `/` on every platform, so a `\` in a Unix file name stays a character
        let normalized = relative_path
            .components()
            .map(|component| component.as_os_str().to_string_lossy())
            .collect::<Vec<_>>()
            .join("/");
        if !include.is_match(&normalized) || exclude.is_match(&normalized) {
            continue;
        }

        let html = std::fs::read_to_string(entry.path()).map_err(|source| Error::FileRead {
            path: entry.path().to_path_buf(),
            source,
        })?;
        let page_url = extractor.url_for_file(&normalized);

        let (node, page_edges) = extractor.extract_page(&html, &page_url)?;

        nodes.push(node);
        edges.extend(page_edges);
    }

    nodes.sort_by(|a, b| a.url.cmp(&b.url));
    let node_urls: HashSet<&str> = nodes.iter().map(|node| node.url.as_str()).collect();
    edges.retain_mut(|edge| match edge.edge_type {
        EdgeType::Friend => true,
        // A link from `/about/` to `/about` resolves to the page itself
        EdgeType::Internal => {
            resolve_internal_target(&node_urls, &mut edge.target) && edge.target != edge.source
        }
    });
    edges.sort_by(|a, b| (&a.source, &a.target).cmp(&(&b.source, &b.target)));
    edges.dedup();

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

/// Rewrites `target` to the node URL it designates, with or without a trailing slash since static
/// hosts serve both.
fn resolve_internal_target(node_urls: &HashSet<&str>, target: &mut String) -> bool {
    if node_urls.contains(target.as_str()) {
        return true;
    }
    let alternate = match target.strip_suffix('/') {
        Some(stem) if !stem.is_empty() => stem.to_owned(),
        _ => format!("{target}/"),
    };
    if node_urls.contains(alternate.as_str()) {
        *target = alternate;
        return true;
    }
    false
}

/// Returns the current UTC time formatted as ISO 8601 (`YYYY-MM-DDTHH:MM:SSZ`).
fn utc_timestamp() -> String {
    Timestamp::now().strftime("%Y-%m-%dT%H:%M:%SZ").to_string()
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;

    use tempfile::TempDir;

    use super::*;
    use crate::config::{OutputConfig, ParseConfig, SiteConfig};
    use crate::model::Edge;

    const PAGE: &str = "<html><head><title>Page</title></head><body></body></html>";

    fn test_config(output_dir: &Path) -> Config {
        Config {
            site: SiteConfig {
                base_url: String::from("https://alice.dev/"),
                title: String::from("Alice's Garden"),
                description: None,
                language: None,
            },
            friends: vec![String::from("https://bob.dev/")],
            output: OutputConfig {
                dir: output_dir.to_str().unwrap().to_owned(),
            },
            parse: ParseConfig::default(),
        }
    }

    fn write_file(dir: &Path, relative: &str, content: &str) {
        let path = dir.join(relative);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, content).unwrap();
    }

    fn page_linking_to(hrefs: &[&str]) -> String {
        let links: String = hrefs
            .iter()
            .map(|href| format!("<a href=\"{href}\">link</a>"))
            .collect();
        format!("<html><head><title>Page</title></head><body>{links}</body></html>")
    }

    fn edge(source: &str, target: &str, edge_type: EdgeType) -> Edge {
        Edge {
            source: source.to_owned(),
            target: target.to_owned(),
            edge_type,
        }
    }

    #[test]
    fn build_assembles_nodes_and_edges() {
        let tmp = TempDir::new().unwrap();
        write_file(
            tmp.path(),
            "index.html",
            r#"<html><head><title>Home</title></head><body>
                <a href="/about/">About</a>
                <a href="https://bob.dev/">Bob</a>
                <a href="https://random.com/">Random</a>
            </body></html>"#,
        );
        write_file(
            tmp.path(),
            "about/index.html",
            r#"<html><head><title>About</title></head><body><a href="/">Home</a></body></html>"#,
        );

        let result = build(&test_config(tmp.path())).unwrap();

        assert_eq!(result.version, model::PROTOCOL_VERSION);
        assert_eq!(result.base_url, "https://alice.dev/");
        assert_eq!(result.site.title, "Alice's Garden");
        assert_eq!(result.friends, vec!["https://bob.dev/"]);
        assert!(
            result.generated_at.parse::<Timestamp>().is_ok() && result.generated_at.ends_with('Z'),
            "generated_at should be an ISO 8601 UTC timestamp, got {}",
            result.generated_at
        );
        let titles: Vec<(&str, &str)> = result
            .nodes
            .iter()
            .map(|n| (n.url.as_str(), n.title.as_str()))
            .collect();
        assert_eq!(titles, vec![("/", "Home"), ("/about/", "About")]);
        assert_eq!(
            result.edges,
            vec![
                edge("/", "/about/", EdgeType::Internal),
                edge("/", "https://bob.dev/", EdgeType::Friend),
                edge("/about/", "/", EdgeType::Internal),
            ]
        );
    }

    #[test]
    fn build_output_is_sorted_whatever_the_creation_order() {
        let tmp = TempDir::new().unwrap();
        let pages = ["z.html", "m/index.html", "a.html", "m/sub/q.html", "b.html"];
        let all: Vec<String> = pages.iter().map(|p| format!("/{p}")).collect();
        for page in pages.iter().rev() {
            let hrefs: Vec<&str> = all.iter().map(String::as_str).collect();
            write_file(tmp.path(), page, &page_linking_to(&hrefs));
        }

        let result = build(&test_config(tmp.path())).unwrap();

        let urls: Vec<&str> = result.nodes.iter().map(|n| n.url.as_str()).collect();
        assert_eq!(urls, vec!["/a", "/b", "/m/", "/m/sub/q", "/z"]);
        let pairs: Vec<(&str, &str)> = result
            .edges
            .iter()
            .map(|e| (e.source.as_str(), e.target.as_str()))
            .collect();
        let mut sorted = pairs.clone();
        sorted.sort_unstable();
        assert_eq!(pairs, sorted);
    }

    #[test]
    fn build_drops_internal_edges_to_pages_outside_the_graph() {
        let tmp = TempDir::new().unwrap();
        write_file(
            tmp.path(),
            "index.html",
            &page_linking_to(&[
                "/about",
                "/admin/",
                "/missing",
                "/cv.pdf",
                "https://bob.dev/anything",
            ]),
        );
        write_file(tmp.path(), "about.html", PAGE);
        write_file(tmp.path(), "admin/index.html", PAGE);
        write_file(tmp.path(), "cv.pdf", "%PDF-1.4");

        let mut config = test_config(tmp.path());
        config.parse.exclude = vec![String::from("admin/**")];
        let result = build(&config).unwrap();

        assert_eq!(
            result.edges,
            vec![
                edge("/", "/about", EdgeType::Internal),
                edge("/", "https://bob.dev/anything", EdgeType::Friend),
            ]
        );
    }

    #[test]
    fn build_matches_targets_to_nodes_across_trailing_slash() {
        let tmp = TempDir::new().unwrap();
        write_file(
            tmp.path(),
            "index.html",
            &page_linking_to(&["/about", "/about/", "/posts/hello/"]),
        );
        // Each page also links to its own other slash form, which must not become a self-loop
        write_file(
            tmp.path(),
            "about/index.html",
            &page_linking_to(&["/about"]),
        );
        write_file(
            tmp.path(),
            "posts/hello.html",
            &page_linking_to(&["/posts/hello/", "/"]),
        );

        let result = build(&test_config(tmp.path())).unwrap();

        assert_eq!(
            result.edges,
            vec![
                edge("/", "/about/", EdgeType::Internal),
                edge("/", "/posts/hello", EdgeType::Internal),
                edge("/posts/hello", "/", EdgeType::Internal),
            ]
        );
    }

    #[test]
    fn build_applies_include_and_exclude_globs() {
        let tmp = TempDir::new().unwrap();
        write_file(tmp.path(), "index.html", PAGE);
        write_file(tmp.path(), "notes.htm", PAGE);
        write_file(tmp.path(), "drafts/wip.htm", PAGE);
        write_file(tmp.path(), "style.css", "body { color: red; }");

        let mut config = test_config(tmp.path());
        config.parse.include = vec![String::from("**/*.htm")];
        config.parse.exclude = vec![String::from("drafts/**")];
        let result = build(&config).unwrap();

        let urls: Vec<&str> = result.nodes.iter().map(|n| n.url.as_str()).collect();
        assert_eq!(urls, vec!["/notes.htm"]);
    }

    #[test]
    fn build_skips_non_html_files_by_default() {
        let tmp = TempDir::new().unwrap();
        write_file(tmp.path(), "style.css", "body { color: red; }");
        write_file(tmp.path(), "script.js", "console.log('hi');");
        write_file(tmp.path(), "image.png", "fake png data");

        let result = build(&test_config(tmp.path())).unwrap();
        assert!(result.nodes.is_empty());
        assert!(result.edges.is_empty());

        write_file(tmp.path(), "index.html", PAGE);
        let result = build(&test_config(tmp.path())).unwrap();
        assert_eq!(result.nodes.len(), 1);
        assert_eq!(result.nodes[0].url, "/");
    }

    #[test]
    fn build_applies_exclude_selectors() {
        let tmp = TempDir::new().unwrap();
        write_file(
            tmp.path(),
            "index.html",
            r#"<html><body><nav><a href="/hidden">Hidden</a></nav><a href="/visible">Visible</a></body></html>"#,
        );
        write_file(tmp.path(), "hidden.html", PAGE);
        write_file(tmp.path(), "visible.html", PAGE);

        let mut config = test_config(tmp.path());
        config.parse.exclude_selectors = vec![String::from("nav")];
        let result = build(&config).unwrap();

        assert_eq!(
            result.edges,
            vec![edge("/", "/visible", EdgeType::Internal)]
        );
    }

    #[test]
    fn build_rejects_invalid_config_values() {
        let tmp = TempDir::new().unwrap();

        let mut config = test_config(tmp.path());
        config.site.base_url = String::from("https://alice.dev/garden/");
        assert!(matches!(build(&config), Err(Error::InvalidBaseUrl { .. })));

        let mut config = test_config(tmp.path());
        config.parse.include = vec![String::from("**/[unclosed")];
        assert!(matches!(build(&config), Err(Error::GlobPattern(_))));
    }
}
