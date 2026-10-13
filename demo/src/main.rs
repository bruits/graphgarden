use std::error::Error;
use std::fs;
use std::path::Path;

use graphgarden_core::build::build;
use graphgarden_core::config::Config;
use maudit::{BuildOptions, BuildOutput, content_sources, coronate, routes};

mod layout;
mod routes;

use routes::{Index, Join, Tutorial};

const GARDEN: &str = include_str!("../graphgarden.toml");

pub fn garden() -> Result<Config, Box<dyn Error>> {
    parse_garden(GARDEN)
}

fn parse_garden(source: &str) -> Result<Config, Box<dyn Error>> {
    let config: Config = source.parse()?;
    // The core accepts `http://`, but browsers block its fetch from this HTTPS site as mixed content
    if let Some(friend) = config.friends.iter().find(|f| !f.starts_with("https://")) {
        return Err(format!("friend '{friend}' must use https://, or browsers block it").into());
    }
    Ok(config)
}

fn main() -> Result<BuildOutput, Box<dyn Error>> {
    let config = garden()?;
    let output = coronate(
        routes![Index, Tutorial, Join],
        content_sources![],
        BuildOptions {
            base_url: Some(config.site.base_url.clone()),
            // Incremental builds keep `dist/`, and a removed page would stay in the graph
            incremental: false,
            ..Default::default()
        },
    )?;

    // Validation needs the built output directory
    config.validate()?;
    let json = build(&config)?.to_json()?;
    let well_known = Path::new(&config.output.dir).join(".well-known");
    fs::create_dir_all(&well_known)?;
    fs::write(well_known.join("graphgarden.json"), json)?;
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn garden_rejects_plain_http_friends() {
        let source = r#"
            friends = ["https://bob.dev/", "http://carol.dev/"]

            [site]
            base_url = "https://garden.bruits.org/"
            title = "GraphGarden"
        "#;

        let error = parse_garden(source).expect_err("an http friend should be rejected");

        assert!(error.to_string().contains("http://carol.dev/"));
    }
}
