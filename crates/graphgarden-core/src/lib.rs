//! # GraphGarden Core
//!
//! A protocol and toolkit to turn web rings into explorable link graphs 🪴
//! Core library for crawling, graph model, and link extraction.

pub mod build;
pub mod config;
pub mod error;
pub mod extract;
pub mod fetch;
pub mod model;

pub use error::{Error, Result};
pub use model::PROTOCOL_VERSION;
