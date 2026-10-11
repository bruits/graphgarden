use std::fs;

use assert_cmd::Command;
use assert_cmd::assert::Assert;
use assert_cmd::cargo_bin_cmd;
use graphgarden_core::PROTOCOL_VERSION;
use graphgarden_core::model::{Edge, EdgeType, Node, PublicFile, SiteMetadata};
use predicates::str::contains;
use tempfile::TempDir;

const DEFAULT_CONFIG: &str = r#"
[site]
base_url = "https://test.dev/"
title = "Test Site"

[output]
dir = "dist"
"#;

/// The CLI runs from inside the temp dir, so configs use a relative `output.dir` and need no
/// `--config`.
struct Site {
    tmp: TempDir,
}

impl Site {
    fn new() -> Self {
        let tmp = TempDir::new().unwrap();
        fs::create_dir(tmp.path().join("dist")).unwrap();
        let site = Self { tmp };
        site.config(DEFAULT_CONFIG);
        site
    }

    fn config(&self, toml: &str) -> &Self {
        fs::write(self.tmp.path().join("graphgarden.toml"), toml).unwrap();
        self
    }

    fn page(&self, relative: &str, html: &str) -> &Self {
        let path = self.tmp.path().join("dist").join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, html).unwrap();
        self
    }

    fn command(&self) -> Command {
        let mut command = cargo_bin_cmd!("graphgarden");
        command.current_dir(self.tmp.path());
        command
    }

    fn build(&self) -> PublicFile {
        self.command().arg("build").assert().success();
        let json = fs::read_to_string(self.tmp.path().join("dist/.well-known/graphgarden.json"))
            .expect("protocol file should be written");
        PublicFile::from_json(&json).expect("protocol file should be valid")
    }

    fn build_failure(&self) -> Assert {
        self.command().arg("build").assert().failure().code(1)
    }
}

fn page(title: &str, body: &str) -> String {
    format!("<html><head><title>{title}</title></head><body>{body}</body></html>")
}

fn node(url: &str, title: &str) -> Node {
    Node {
        url: url.to_owned(),
        title: title.to_owned(),
    }
}

fn edge(source: &str, target: &str, edge_type: EdgeType) -> Edge {
    Edge {
        source: source.to_owned(),
        target: target.to_owned(),
        edge_type,
    }
}

#[test]
fn build_writes_the_protocol_file() {
    let site = Site::new();
    site.config(
        r#"
        friends = ["https://bob.dev/"]

        [site]
        base_url = "https://test.dev/"
        title = "My Garden"
        description = "A lovely garden"
        language = "en"

        [output]
        dir = "dist"

        [parse]
        exclude = ["admin/**"]
        exclude_selectors = ["nav"]
        "#,
    )
    .page(
        "index.html",
        &page(
            "Home",
            r#"<nav><a href="/posts/hello">Hello</a></nav>
               <a href="/about/">About</a>
               <a href="https://bob.dev/">Bob</a>
               <a href="https://external.com/">External</a>
               <a href="/admin/">Admin</a>"#,
        ),
    )
    .page(
        "about/index.html",
        &page(
            "About",
            r##"<a href="/">Home</a> <a href="https://bob.dev/posts/cool">Cool</a> <a href="#top">Top</a>"##,
        ),
    )
    .page(
        "posts/hello.html",
        &page("Hello World", r#"<a href="../about/index.html">About</a>"#),
    )
    .page("admin/index.html", &page("Admin", ""));

    let first = site.build();
    let second = site.build();

    assert!(!first.generated_at.is_empty());
    let expected = PublicFile {
        version: String::from(PROTOCOL_VERSION),
        generated_at: first.generated_at.clone(),
        base_url: String::from("https://test.dev/"),
        site: SiteMetadata {
            title: String::from("My Garden"),
            description: Some(String::from("A lovely garden")),
            language: Some(String::from("en")),
        },
        friends: vec![String::from("https://bob.dev/")],
        nodes: vec![
            node("/", "Home"),
            node("/about/", "About"),
            node("/posts/hello", "Hello World"),
        ],
        edges: vec![
            edge("/", "/about/", EdgeType::Internal),
            edge("/", "https://bob.dev/", EdgeType::Friend),
            edge("/about/", "/", EdgeType::Internal),
            edge("/about/", "https://bob.dev/posts/cool", EdgeType::Friend),
            edge("/posts/hello", "/about/", EdgeType::Internal),
        ],
    };
    assert_eq!(first, expected);
    assert_eq!(
        PublicFile {
            generated_at: first.generated_at.clone(),
            ..second
        },
        expected,
        "rebuilding an unchanged site must overwrite the file with the same content"
    );
}

#[test]
fn build_accepts_a_config_path() {
    let site = Site::new();
    fs::remove_file(site.tmp.path().join("graphgarden.toml")).unwrap();
    fs::create_dir(site.tmp.path().join("conf")).unwrap();
    fs::write(site.tmp.path().join("conf/custom.toml"), DEFAULT_CONFIG).unwrap();
    site.page("index.html", &page("Home", ""));

    site.command()
        .args(["build", "--config", "conf/custom.toml"])
        .assert()
        .success()
        .stdout(contains("dist/.well-known/graphgarden.json"));

    assert!(
        site.tmp
            .path()
            .join("dist/.well-known/graphgarden.json")
            .exists()
    );
}

#[test]
fn build_fails_when_config_is_missing() {
    Site::new()
        .command()
        .args(["build", "--config", "nonexistent.toml"])
        .assert()
        .failure()
        .code(1)
        .stderr(contains("failed to load config from nonexistent.toml"))
        .stderr(contains("config file not found"));
}

#[test]
fn build_fails_on_invalid_config() {
    let cases = [
        (
            "base_url with a path",
            "[site]\nbase_url = \"https://test.dev/garden/\"\ntitle = \"T\"\n[output]\ndir = \"dist\"\n",
            "invalid base_url",
        ),
        (
            "missing output dir",
            "[site]\nbase_url = \"https://test.dev/\"\ntitle = \"T\"\n[output]\ndir = \"nope\"\n",
            "output directory does not exist",
        ),
        (
            "invalid selector",
            "[site]\nbase_url = \"https://test.dev/\"\ntitle = \"T\"\n[output]\ndir = \"dist\"\n[parse]\nexclude_selectors = [\"a]\"]\n",
            "invalid CSS selector",
        ),
        (
            "malformed toml",
            "[site\nbase_url = ",
            "failed to parse config",
        ),
    ];

    for (label, toml, expected) in cases {
        let site = Site::new();
        site.config(toml);
        let assert = site.build_failure();
        let stderr = String::from_utf8_lossy(&assert.get_output().stderr);
        assert!(stderr.contains(expected), "{label}: stderr was:\n{stderr}");
    }
}

#[test]
fn version_flag_prints_the_crate_version() {
    cargo_bin_cmd!("graphgarden")
        .arg("--version")
        .assert()
        .success()
        .stdout(contains(env!("CARGO_PKG_VERSION")));
}
