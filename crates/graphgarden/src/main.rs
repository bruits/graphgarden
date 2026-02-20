use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(
    name = "graphgarden",
    about = "Turn web rings into explorable node graphs"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Walk a built site, extract links, and generate the protocol file
    Build {
        /// Path to the configuration file
        #[arg(long, default_value = "graphgarden.toml")]
        config: PathBuf,
    },
}

fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Command::Build { config } => run_build(&config),
    }
}

fn run_build(config_path: &Path) -> Result<()> {
    let config = graphgarden_core::config::Config::from_file(config_path).context(format!(
        "failed to load config from {}",
        config_path.display()
    ))?;

    config.validate().context("config validation failed")?;

    let output_dir = PathBuf::from(&config.output.dir);

    let public_file = graphgarden_core::build::build(&config)
        .context("failed to build the graph from the output directory")?;

    let json = public_file
        .to_json()
        .context("failed to serialize the public file to JSON")?;

    let well_known = output_dir.join(".well-known");
    fs::create_dir_all(&well_known).context(format!(
        "failed to create directory {}",
        well_known.display()
    ))?;

    let destination = well_known.join("graphgarden.json");
    fs::write(&destination, json).context(format!("failed to write {}", destination.display()))?;

    println!("✔ wrote {}", destination.display());
    Ok(())
}
