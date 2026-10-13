use maud::{DOCTYPE, Markup, html};

pub const REPOSITORY: &str = "https://github.com/bruits/graphgarden";

/// Wraps `main` in the page shell. `shape` is `map` for the full-window graph, `text` otherwise.
pub fn layout(title: &str, shape: &str, main: Markup) -> Markup {
    html! {
        (DOCTYPE)
        html lang="en" {
            head {
                meta charset="utf-8";
                meta name="viewport" content="width=device-width, initial-scale=1";
                // Also the page's label in the graph
                title { (title) }
                @for face in ["Regular", "Italic", "Bold"] {
                    link rel="preload" href=(format!("/fonts/Libron-{face}.woff2")) as="font" type="font/woff2" crossorigin;
                }
                link rel="stylesheet" href="/style.css";
                // Classic script, so it runs before the component's module
                script src="/capture.js" {}
            }
            body class=(shape) {
                div.sheet {
                    header {
                        a.brand href="/" { "GraphGarden" }
                        nav {
                            a href="/tutorial/" { "Tutorial" }
                            a href="/join/" { "Join" }
                            a href=(REPOSITORY) { "GitHub" }
                        }
                    }
                    main { (main) }
                }
            }
        }
    }
}
