//! # GraphGarden Core
//!
//! A protocol and toolkit to turn web rings into explorable link graphs 🪴
//!
//! Core library of the GraphGarden protocol. It walks a built site's HTML, extracts and
//! classifies its links, and assembles the public `graphgarden.json` file.

pub mod build;
pub mod config;
pub mod error;
pub mod extract;
pub mod model;

pub use error::{Error, Result};
pub use model::PROTOCOL_VERSION;
