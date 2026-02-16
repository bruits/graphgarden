//! # GraphGarden Core
//!
//! Let's turn web rings into explorable link graphs 🪴
//! Core library for crawling, graph model, and link extraction.

/// Placeholder – the real graph model will live here.
pub fn hello() -> &'static str {
    "Hello from GraphGarden!"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn it_works() {
        assert_eq!(hello(), "Hello from GraphGarden!");
    }
}
