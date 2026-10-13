use maud::{PreEscaped, html};
use maudit::content::render_markdown;
use maudit::route::prelude::*;

use crate::garden;
use crate::layout::{REPOSITORY, layout};

// Built by `pnpm run build` in the repository, before this site
const COMPONENT: &str = "../packages/graphgarden-web/dist/graphgarden.js";

#[route("/")]
pub struct Index;

impl Route for Index {
    fn render(&self, ctx: &mut PageContext) -> impl Into<RenderResult> {
        ctx.assets.include_script(COMPONENT)?;

        Ok(layout(
            ctx.current_path,
            "GraphGarden",
            "map",
            html! {
                graph-garden {}
                p.legend {
                    "Green nodes are this site's pages, amber ones belong to the sites it gathers, "
                    "and grey ones are links nobody describes yet. A ring marks each site's home. "
                    "Click or tap a node to visit it, and hover it to see its neighbours."
                }
            },
        ))
    }
}

#[route("/tutorial/")]
pub struct Tutorial;

impl Route for Tutorial {
    fn render(&self, ctx: &mut PageContext) -> impl Into<RenderResult> {
        let tutorial = render_markdown(include_str!("../content/tutorial.md"), None, None, None);
        layout(
            ctx.current_path,
            "Tutorial",
            "text",
            html! { (PreEscaped(tutorial)) },
        )
    }
}

#[route("/join/")]
pub struct Join;

impl Route for Join {
    fn render(&self, ctx: &mut PageContext) -> impl Into<RenderResult> {
        let participants = garden()?.friends;

        Ok(layout(
            ctx.current_path,
            "Join",
            "text",
            html! {
                h1 { "Join" }
                p { "There are three ways to take part." }

                h2 { "Grow your own garden" }
                p {
                    "GraphGarden is free software, and its protocol needs no sign-up. Publish your site's "
                    "file, list your friends, and show the graph with " code { "<graph-garden>" }
                    ", all on your own site. The " a href="/tutorial/" { "tutorial" } " walks through each step."
                }

                h2 { "Join the shared garden" }
                p {
                    "This site draws a shared garden. To appear on it, open a pull request that adds "
                    "your site's origin to " code { "friends" } " in "
                    a href=(format!("{REPOSITORY}/blob/main/demo/graphgarden.toml")) { code { "demo/graphgarden.toml" } }
                    ". Your site has to"
                }
                ul {
                    li { "be served over HTTPS," }
                    li { "publish " code { "/.well-known/graphgarden.json" } " with the CORS header from the tutorial," }
                    li { "link to GraphGarden at least once, to this site or to the repository." }
                }
                p {
                    "Sites that share the values of the indie web, of craft, and of free software are most "
                    "welcome. Hateful, pornographic, gambling, scam, or otherwise toxic content is not "
                    "accepted. Maintainers decide at their discretion and may remove a site later. The "
                    a href=(format!("{REPOSITORY}/blob/main/CODE_OF_CONDUCT.md")) { "code of conduct" }
                    " applies to the pull request and its discussion."
                }

                h2 { "Contribute" }
                p {
                    "GraphGarden is developed in the open on " a href=(REPOSITORY) { "GitHub" } ". "
                    a href=(format!("{REPOSITORY}/blob/main/CONTRIBUTING.md")) { "CONTRIBUTING.md" }
                    " is the place to start, bugs and feature requests go to the "
                    a href=(format!("{REPOSITORY}/issues")) { "issue tracker" }
                    ", and questions are welcome on " a href="https://discord.com/invite/84pd4QtmzA" { "Discord" } "."
                }

                h2 { "In the garden today" }
                ul {
                    @for site in &participants {
                        li { a href=(site) { (site.trim_start_matches("https://").trim_end_matches('/')) } }
                    }
                }

                p.credits {
                    "This site is built with " a href="https://maudit.org/" { "Maudit" } " and set in "
                    a href="https://github.com/nicoverbruggen/libron" { "Libron" } "."
                }
            },
        ))
    }
}
