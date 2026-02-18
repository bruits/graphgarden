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

#[test]
fn build_happy_path() {
    let tmp = TempDir::new().unwrap();

    // Create a minimal HTML site in a subdirectory used as the output dir.
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

    // Write the config file next to the output dir.
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

    // Derive a guaranteed-missing path from the TempDir (which starts empty).
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
