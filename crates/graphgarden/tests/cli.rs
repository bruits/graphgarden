use std::collections::HashSet;
use std::fs;
use std::path::Path;

use assert_cmd::cargo_bin_cmd;
use tempfile::TempDir;

fn write_file(dir: &Path, relative: &str, content: &str) {
    let path = dir.join(relative);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(path, content).unwrap();
}

fn minimal_config(base_url: &str, output_dir: &str) -> String {
    format!(
        r#"[site]
base_url = "{base_url}"
title = "Test Site"

[output]
dir = "{output_dir}"
"#,
    )
}

fn full_config(options: &ConfigOptions) -> String {
    let mut toml = String::new();

    if !options.friends.is_empty() {
        let items: Vec<String> = options.friends.iter().map(|f| format!("\"{f}\"")).collect();
        toml.push_str(&format!("friends = [{}]\n\n", items.join(", ")));
    }

    let base_url = options.base_url;
    let title = options.title;
    toml.push_str(&format!(
        "[site]\nbase_url = \"{base_url}\"\ntitle = \"{title}\"\n"
    ));
    if let Some(desc) = options.description {
        toml.push_str(&format!("description = \"{desc}\"\n"));
    }
    if let Some(lang) = options.language {
        toml.push_str(&format!("language = \"{lang}\"\n"));
    }

    let output_dir = options.output_dir;
    toml.push_str(&format!("\n[output]\ndir = \"{output_dir}\"\n"));

    if !options.exclude.is_empty() || !options.exclude_selectors.is_empty() {
        toml.push_str("\n[parse]\n");
        if !options.exclude.is_empty() {
            let items: Vec<String> = options.exclude.iter().map(|e| format!("\"{e}\"")).collect();
            toml.push_str(&format!("exclude = [{}]\n", items.join(", ")));
        }
        if !options.exclude_selectors.is_empty() {
            let items: Vec<String> = options
                .exclude_selectors
                .iter()
                .map(|s| format!("\"{s}\""))
                .collect();
            toml.push_str(&format!("exclude_selectors = [{}]\n", items.join(", ")));
        }
    }

    toml
}

struct ConfigOptions<'a> {
    base_url: &'a str,
    title: &'a str,
    output_dir: &'a str,
    description: Option<&'a str>,
    language: Option<&'a str>,
    friends: &'a [&'a str],
    exclude: &'a [&'a str],
    exclude_selectors: &'a [&'a str],
}

const DEFAULTS: ConfigOptions<'static> = ConfigOptions {
    base_url: "",
    title: "",
    output_dir: "",
    description: None,
    language: None,
    friends: &[],
    exclude: &[],
    exclude_selectors: &[],
};

/// Runs a `graphgarden build` and returns the parsed output JSON.
fn run_build_and_read_output(config_path: &Path, output_dir: &Path) -> serde_json::Value {
    cargo_bin_cmd!("graphgarden")
        .args(["build", "--config", config_path.to_str().unwrap()])
        .assert()
        .success();

    let json_path = output_dir.join(".well-known/graphgarden.json");
    assert!(json_path.exists(), "protocol file should be written");

    let content = fs::read_to_string(&json_path).unwrap();
    serde_json::from_str(&content).expect("protocol file should contain valid JSON")
}

#[test]
fn build_happy_path() {
    let tmp = TempDir::new().unwrap();

    let output_dir = tmp.path().join("dist");
    fs::create_dir_all(&output_dir).unwrap();

    write_file(
        &output_dir,
        "index.html",
        r#"<html><head><title>Home</title></head><body>
            <a href="/about/">About</a>
        </body></html>"#,
    );
    write_file(
        &output_dir,
        "about/index.html",
        r#"<html><head><title>About</title></head><body>
            <a href="/">Home</a>
        </body></html>"#,
    );

    let config_path = tmp.path().join("graphgarden.toml");
    fs::write(
        &config_path,
        minimal_config("https://test.dev/", output_dir.to_str().unwrap()),
    )
    .unwrap();

    cargo_bin_cmd!("graphgarden")
        .args(["build", "--config", config_path.to_str().unwrap()])
        .assert()
        .success();

    let json_path = output_dir.join(".well-known/graphgarden.json");
    assert!(json_path.exists(), "protocol file should be written");

    let content = fs::read_to_string(&json_path).unwrap();
    let value: serde_json::Value =
        serde_json::from_str(&content).expect("protocol file should contain valid JSON");

    assert_eq!(value["base_url"], "https://test.dev/");
    assert_eq!(value["site"]["title"], "Test Site");
    assert!(!value["nodes"].as_array().unwrap().is_empty());
}

#[test]
fn build_missing_config() {
    cargo_bin_cmd!("graphgarden")
        .args(["build", "--config", "nonexistent.toml"])
        .assert()
        .failure()
        .stderr(predicates::str::contains("failed to load config"));
}

#[test]
fn build_missing_output_dir() {
    let tmp = TempDir::new().unwrap();

    let missing_output = tmp.path().join("no_such_dir");

    let config_path = tmp.path().join("graphgarden.toml");
    fs::write(
        &config_path,
        minimal_config("https://test.dev/", missing_output.to_str().unwrap()),
    )
    .unwrap();

    cargo_bin_cmd!("graphgarden")
        .args(["build", "--config", config_path.to_str().unwrap()])
        .assert()
        .failure()
        .stderr(predicates::str::contains(
            "does not exist or is not a directory",
        ));
}

#[test]
fn build_multi_page_internal_links() {
    let tmp = TempDir::new().unwrap();
    let output_dir = tmp.path().join("dist");
    fs::create_dir_all(&output_dir).unwrap();

    write_file(
        &output_dir,
        "index.html",
        r#"<html><head><title>Home</title></head><body>
            <a href="/about/">About</a>
            <a href="/posts/hello">Hello Post</a>
        </body></html>"#,
    );
    write_file(
        &output_dir,
        "about/index.html",
        r#"<html><head><title>About</title></head><body>
            <a href="/">Home</a>
        </body></html>"#,
    );
    write_file(
        &output_dir,
        "posts/hello.html",
        r#"<html><head><title>Hello World</title></head><body>
            <a href="/about/">About</a>
        </body></html>"#,
    );

    let config_path = tmp.path().join("graphgarden.toml");
    fs::write(
        &config_path,
        minimal_config("https://test.dev/", output_dir.to_str().unwrap()),
    )
    .unwrap();

    let value = run_build_and_read_output(&config_path, &output_dir);

    let nodes = value["nodes"].as_array().unwrap();
    assert_eq!(nodes.len(), 3);

    let node_urls: HashSet<&str> = nodes.iter().map(|n| n["url"].as_str().unwrap()).collect();
    assert!(node_urls.contains("/"));
    assert!(node_urls.contains("/about/"));
    assert!(node_urls.contains("/posts/hello"));

    let edges = value["edges"].as_array().unwrap();
    assert_eq!(edges.len(), 4);

    let has_edge = |source: &str, target: &str, edge_type: &str| {
        edges
            .iter()
            .any(|e| e["source"] == source && e["target"] == target && e["type"] == edge_type)
    };

    assert!(has_edge("/", "/about/", "internal"));
    assert!(has_edge("/", "/posts/hello", "internal"));
    assert!(has_edge("/about/", "/", "internal"));
    assert!(has_edge("/posts/hello", "/about/", "internal"));

    assert!(edges.iter().all(|e| e["type"] == "internal"));
}

#[test]
fn build_friend_links() {
    let tmp = TempDir::new().unwrap();
    let output_dir = tmp.path().join("dist");
    fs::create_dir_all(&output_dir).unwrap();

    write_file(
        &output_dir,
        "index.html",
        r#"<html><head><title>Home</title></head><body>
            <a href="/about/">About</a>
            <a href="https://bob.dev/">Bob's Site</a>
            <a href="https://external.com/">External</a>
        </body></html>"#,
    );
    write_file(
        &output_dir,
        "about/index.html",
        r#"<html><head><title>About</title></head><body>
            <a href="/">Home</a>
            <a href="https://bob.dev/posts/cool">Bob's Post</a>
        </body></html>"#,
    );

    let config_path = tmp.path().join("graphgarden.toml");
    fs::write(
        &config_path,
        full_config(&ConfigOptions {
            base_url: "https://test.dev/",
            title: "Test Site",
            output_dir: output_dir.to_str().unwrap(),
            friends: &["https://bob.dev/"],
            ..DEFAULTS
        }),
    )
    .unwrap();

    let value = run_build_and_read_output(&config_path, &output_dir);
    let edges = value["edges"].as_array().unwrap();

    assert!(
        edges.iter().any(|e| e["source"] == "/"
            && e["target"] == "https://bob.dev/"
            && e["type"] == "friend")
    );
    assert!(edges.iter().any(|e| e["source"] == "/about/"
        && e["target"] == "https://bob.dev/posts/cool"
        && e["type"] == "friend"));

    assert!(
        !edges.iter().any(|e| {
            let target = e["target"].as_str().unwrap_or("");
            target.contains("external.com")
        }),
        "external non-friend links should be dropped"
    );

    assert!(
        edges
            .iter()
            .any(|e| e["source"] == "/" && e["target"] == "/about/" && e["type"] == "internal")
    );
    assert!(
        edges
            .iter()
            .any(|e| e["source"] == "/about/" && e["target"] == "/" && e["type"] == "internal")
    );
}

#[test]
fn build_exclude_patterns() {
    let tmp = TempDir::new().unwrap();
    let output_dir = tmp.path().join("dist");
    fs::create_dir_all(&output_dir).unwrap();

    write_file(
        &output_dir,
        "index.html",
        r#"<html><head><title>Home</title></head><body>
            <a href="/admin/">Admin</a>
        </body></html>"#,
    );
    write_file(
        &output_dir,
        "admin/index.html",
        r#"<html><head><title>Admin</title></head><body>
            <a href="/">Home</a>
        </body></html>"#,
    );

    let config_path = tmp.path().join("graphgarden.toml");
    fs::write(
        &config_path,
        full_config(&ConfigOptions {
            base_url: "https://test.dev/",
            title: "Test Site",
            output_dir: output_dir.to_str().unwrap(),
            exclude: &["admin/**"],
            ..DEFAULTS
        }),
    )
    .unwrap();

    let value = run_build_and_read_output(&config_path, &output_dir);

    let nodes = value["nodes"].as_array().unwrap();
    assert_eq!(nodes.len(), 1);
    assert_eq!(nodes[0]["url"], "/");

    assert!(
        !nodes.iter().any(|n| {
            let url = n["url"].as_str().unwrap_or("");
            url.contains("admin")
        }),
        "admin node should not exist"
    );

    let edges = value["edges"].as_array().unwrap();
    for edge in edges {
        let source = edge["source"].as_str().unwrap_or("");
        assert!(
            !source.contains("admin"),
            "no edge should originate from admin"
        );
    }
}

#[test]
fn build_exclude_selectors() {
    let tmp = TempDir::new().unwrap();
    let output_dir = tmp.path().join("dist");
    fs::create_dir_all(&output_dir).unwrap();

    write_file(
        &output_dir,
        "index.html",
        r#"<html><head><title>Home</title></head><body>
            <nav><a href="/nav-link">Nav Link</a></nav>
            <footer><a href="/footer-link">Footer Link</a></footer>
            <main>
                <a href="/about/">About</a>
                <a href="/contact">Contact</a>
            </main>
        </body></html>"#,
    );
    write_file(
        &output_dir,
        "about/index.html",
        r#"<html><head><title>About</title></head><body>
            <a href="/">Home</a>
        </body></html>"#,
    );

    let config_path = tmp.path().join("graphgarden.toml");
    fs::write(
        &config_path,
        full_config(&ConfigOptions {
            base_url: "https://test.dev/",
            title: "Test Site",
            output_dir: output_dir.to_str().unwrap(),
            exclude_selectors: &["nav", "footer"],
            ..DEFAULTS
        }),
    )
    .unwrap();

    let value = run_build_and_read_output(&config_path, &output_dir);
    let edges = value["edges"].as_array().unwrap();

    assert!(
        !edges.iter().any(|e| {
            let target = e["target"].as_str().unwrap_or("");
            target == "/nav-link" || target == "/footer-link"
        }),
        "links inside excluded selectors should not appear as edges"
    );

    assert!(
        edges
            .iter()
            .any(|e| e["source"] == "/" && e["target"] == "/about/")
    );
    assert!(
        edges
            .iter()
            .any(|e| e["source"] == "/" && e["target"] == "/contact")
    );
}

#[test]
fn build_full_config() {
    let tmp = TempDir::new().unwrap();
    let output_dir = tmp.path().join("dist");
    fs::create_dir_all(&output_dir).unwrap();

    write_file(
        &output_dir,
        "index.html",
        r#"<html><head><title>Home</title></head><body>
            <nav><a href="/nav-only">Nav</a></nav>
            <main>
                <a href="/about/">About</a>
                <a href="https://bob.dev/">Bob</a>
                <a href="https://external.com/">External</a>
            </main>
        </body></html>"#,
    );
    write_file(
        &output_dir,
        "about/index.html",
        r#"<html><head><title>About</title></head><body>
            <a href="/">Home</a>
        </body></html>"#,
    );
    write_file(
        &output_dir,
        "admin/index.html",
        r#"<html><head><title>Admin</title></head><body>
            <a href="/">Home</a>
        </body></html>"#,
    );

    let config_path = tmp.path().join("graphgarden.toml");
    fs::write(
        &config_path,
        full_config(&ConfigOptions {
            base_url: "https://test.dev/",
            title: "My Garden",
            output_dir: output_dir.to_str().unwrap(),
            description: Some("A lovely garden"),
            language: Some("en"),
            friends: &["https://bob.dev/"],
            exclude: &["admin/**"],
            exclude_selectors: &["nav"],
        }),
    )
    .unwrap();

    let value = run_build_and_read_output(&config_path, &output_dir);

    assert_eq!(value["site"]["title"], "My Garden");
    assert_eq!(value["site"]["description"], "A lovely garden");
    assert_eq!(value["site"]["language"], "en");
    assert_eq!(value["base_url"], "https://test.dev/");

    let nodes = value["nodes"].as_array().unwrap();
    let node_urls: HashSet<&str> = nodes.iter().map(|n| n["url"].as_str().unwrap()).collect();
    assert_eq!(node_urls.len(), 2);
    assert!(node_urls.contains("/"));
    assert!(node_urls.contains("/about/"));
    assert!(!node_urls.contains("/admin/"));

    let edges = value["edges"].as_array().unwrap();

    assert!(
        !edges
            .iter()
            .any(|e| e["target"].as_str().unwrap_or("") == "/nav-only")
    );

    assert!(
        edges.iter().any(|e| e["source"] == "/"
            && e["target"] == "https://bob.dev/"
            && e["type"] == "friend")
    );

    assert!(
        !edges
            .iter()
            .any(|e| e["target"].as_str().unwrap_or("").contains("external.com"))
    );

    assert!(
        edges
            .iter()
            .any(|e| e["source"] == "/" && e["target"] == "/about/" && e["type"] == "internal")
    );
    assert!(
        edges
            .iter()
            .any(|e| e["source"] == "/about/" && e["target"] == "/" && e["type"] == "internal")
    );
}

#[test]
fn build_protocol_invariants() {
    let tmp = TempDir::new().unwrap();
    let output_dir = tmp.path().join("dist");
    fs::create_dir_all(&output_dir).unwrap();

    write_file(
        &output_dir,
        "index.html",
        r#"<html><head><title>Home</title></head><body>
            <a href="/about/">About</a>
            <a href="/posts/hello">Hello</a>
        </body></html>"#,
    );
    write_file(
        &output_dir,
        "about/index.html",
        r#"<html><head><title>About</title></head><body>
            <a href="/">Home</a>
        </body></html>"#,
    );
    write_file(
        &output_dir,
        "posts/hello.html",
        r#"<html><head><title>Hello World</title></head><body>
            <a href="/about/">About</a>
            <a href="https://bob.dev/">Bob</a>
        </body></html>"#,
    );

    let config_path = tmp.path().join("graphgarden.toml");
    fs::write(
        &config_path,
        full_config(&ConfigOptions {
            base_url: "https://test.dev/",
            title: "Test Site",
            output_dir: output_dir.to_str().unwrap(),
            friends: &["https://bob.dev/"],
            ..DEFAULTS
        }),
    )
    .unwrap();

    let value = run_build_and_read_output(&config_path, &output_dir);

    assert_eq!(value["version"], "0.1.0");

    let generated_at = value["generated_at"].as_str().unwrap();
    assert!(
        is_iso8601_utc(generated_at),
        "generated_at should match YYYY-MM-DDTHH:MM:SSZ, got: {generated_at}"
    );

    let base_url = value["base_url"].as_str().unwrap();
    assert!(
        base_url.ends_with('/'),
        "base_url should have trailing slash"
    );

    let nodes = value["nodes"].as_array().unwrap();
    let edges = value["edges"].as_array().unwrap();

    let node_urls: HashSet<&str> = nodes.iter().map(|n| n["url"].as_str().unwrap()).collect();

    assert_eq!(
        node_urls.len(),
        nodes.len(),
        "there should be no duplicate nodes"
    );

    for edge in edges {
        let source = edge["source"].as_str().unwrap();
        assert!(
            node_urls.contains(source),
            "edge source '{source}' should match a node URL"
        );
    }

    for edge in edges.iter().filter(|e| e["type"] == "internal") {
        let target = edge["target"].as_str().unwrap();
        assert!(
            node_urls.contains(target),
            "internal edge target '{target}' should match a node URL"
        );
    }

    for edge in edges.iter().filter(|e| e["type"] == "friend") {
        let target = edge["target"].as_str().unwrap();
        assert!(
            target.starts_with("http://") || target.starts_with("https://"),
            "friend edge target should be an absolute URL, got: {target}"
        );
    }

    let mut edge_pairs = HashSet::new();
    for edge in edges {
        let pair = (
            edge["source"].as_str().unwrap(),
            edge["target"].as_str().unwrap(),
        );
        assert!(edge_pairs.insert(pair), "duplicate edge found: {:?}", pair);
    }
}

/// Validates that a string matches the `YYYY-MM-DDTHH:MM:SSZ` pattern.
fn is_iso8601_utc(s: &str) -> bool {
    if s.len() != 20 {
        return false;
    }
    let bytes = s.as_bytes();

    // Pattern: DDDD-DD-DDTDD:DD:DDZ where D is a digit
    bytes[0..4].iter().all(u8::is_ascii_digit)
        && bytes[4] == b'-'
        && bytes[5..7].iter().all(u8::is_ascii_digit)
        && bytes[7] == b'-'
        && bytes[8..10].iter().all(u8::is_ascii_digit)
        && bytes[10] == b'T'
        && bytes[11..13].iter().all(u8::is_ascii_digit)
        && bytes[13] == b':'
        && bytes[14..16].iter().all(u8::is_ascii_digit)
        && bytes[16] == b':'
        && bytes[17..19].iter().all(u8::is_ascii_digit)
        && bytes[19] == b'Z'
}

#[test]
fn build_empty_site() {
    let tmp = TempDir::new().unwrap();
    let output_dir = tmp.path().join("dist");
    fs::create_dir_all(&output_dir).unwrap();

    let config_path = tmp.path().join("graphgarden.toml");
    fs::write(
        &config_path,
        minimal_config("https://test.dev/", output_dir.to_str().unwrap()),
    )
    .unwrap();

    let value = run_build_and_read_output(&config_path, &output_dir);

    let nodes = value["nodes"].as_array().unwrap();
    let edges = value["edges"].as_array().unwrap();

    assert!(nodes.is_empty(), "empty site should have no nodes");
    assert!(edges.is_empty(), "empty site should have no edges");

    // JSON is still structurally valid with required top-level fields
    assert_eq!(value["version"], "0.1.0");
    assert!(value["generated_at"].as_str().is_some());
    assert_eq!(value["base_url"], "https://test.dev/");
    assert_eq!(value["site"]["title"], "Test Site");
}

#[test]
fn build_normalizes_links() {
    let tmp = TempDir::new().unwrap();
    let output_dir = tmp.path().join("dist");
    fs::create_dir_all(&output_dir).unwrap();

    write_file(
        &output_dir,
        "index.html",
        r#"<html><head><title>Home</title></head><body>
            <a href="/about/index.html">About (index.html)</a>
            <a href="/posts/hello.html">Hello (html ext)</a>
        </body></html>"#,
    );
    write_file(
        &output_dir,
        "about/index.html",
        r#"<html><head><title>About</title></head><body>
            <a href="/">Home</a>
        </body></html>"#,
    );
    write_file(
        &output_dir,
        "posts/hello.html",
        r#"<html><head><title>Hello</title></head><body>
            <a href="../about/index.html">About (relative)</a>
        </body></html>"#,
    );

    let config_path = tmp.path().join("graphgarden.toml");
    fs::write(
        &config_path,
        minimal_config("https://test.dev/", output_dir.to_str().unwrap()),
    )
    .unwrap();

    let value = run_build_and_read_output(&config_path, &output_dir);

    let edges = value["edges"].as_array().unwrap();

    assert!(
        edges
            .iter()
            .any(|e| e["source"] == "/" && e["target"] == "/about/"),
        "link to /about/index.html should be normalized to /about/"
    );

    assert!(
        edges
            .iter()
            .any(|e| e["source"] == "/" && e["target"] == "/posts/hello"),
        "link to /posts/hello.html should be normalized to /posts/hello"
    );

    assert!(
        edges
            .iter()
            .any(|e| e["source"] == "/posts/hello" && e["target"] == "/about/"),
        "relative link ../about/index.html should resolve and normalize to /about/"
    );

    for edge in edges {
        let target = edge["target"].as_str().unwrap();
        assert!(
            !target.ends_with(".html"),
            "edge target should be normalized (no .html suffix), got: {target}"
        );
    }
}
