use std::borrow::Cow;
use std::cell::Cell;
use std::collections::HashSet;
use std::rc::Rc;

use lol_html::html_content::{Element, EndTag};
use lol_html::{
    ElementContentHandlers, EndTagHandler, HandlerResult, RewriteStrSettings, Selector, element,
    rewrite_str, text,
};
use url::Url;

use crate::config;
use crate::error::{Error, Result};
use crate::model::{Edge, EdgeType, Node};

type Handler<'a> = (Cow<'a, Selector>, ElementContentHandlers<'a>);

#[derive(Debug, Clone)]
pub struct Extractor {
    base: Url,
    friends: Vec<Url>,
    exclude_selectors: Vec<Selector>,
}

impl Extractor {
    /// Parses the site origin, the friend origins and the CSS selectors whose links are ignored.
    ///
    /// # Errors
    ///
    /// Returns [`Error::InvalidBaseUrl`], [`Error::InvalidFriendUrl`] or [`Error::InvalidSelector`]
    /// for a value [`Config::validate`] would reject.
    ///
    /// [`Config::validate`]: crate::config::Config::validate
    pub fn new(base_url: &str, friends: &[String], exclude_selectors: &[String]) -> Result<Self> {
        Ok(Self {
            base: config::parse_base_url(base_url)?,
            friends: config::parse_friends(friends)?,
            exclude_selectors: exclude_selectors
                .iter()
                .map(|selector| config::parse_selector(selector))
                .collect::<Result<_>>()?,
        })
    }

    /// Extracts a page node and its outgoing edges from HTML content.
    ///
    /// `page_url` is the page path in node URL form, e.g. `/about/` for `about/index.html`. Each
    /// `href` resolves against it as in a browser, `<base href>` aside.
    ///
    /// # Errors
    ///
    /// Returns [`Error::HtmlParse`] if the HTML rewriter fails.
    pub fn extract_page(&self, html: &str, page_url: &str) -> Result<(Node, Vec<Edge>)> {
        let mut title = String::new();
        let mut edges = Vec::new();
        let excluded_depth = Rc::new(Cell::new(0));

        let mut handlers = title_handlers(&mut title);
        handlers.extend(self.exclusion_handlers(&excluded_depth));
        handlers.push(self.link_handler(page_url, &excluded_depth, &mut edges));

        let settings = handlers.into_iter().fold(
            RewriteStrSettings::new(),
            RewriteStrSettings::append_element_content_handler,
        );
        rewrite_str(html, settings).map_err(|err| Error::HtmlParse {
            page: page_url.to_owned(),
            reason: err.to_string(),
        })?;

        let title = title.trim().to_owned();
        let node = Node {
            url: page_url.to_owned(),
            title: if title.is_empty() {
                page_url.to_owned()
            } else {
                title
            },
        };
        Ok((node, edges))
    }

    /// Converts a `/`-separated file path relative to the output directory into the page URL path.
    ///
    /// Segments are percent-encoded like link targets, so a `#`, `?` or `\` in a file name stays in
    /// the path.
    pub(crate) fn url_for_file(&self, relative_path: &str) -> String {
        let mut page = self.base.clone();
        page.path_segments_mut()
            .expect("http(s) URLs can be a base")
            .clear()
            .extend(relative_path.split('/'));
        normalize_html_path(page.path())
    }

    /// Counts open excluded elements.
    fn exclusion_handlers(&self, depth: &Rc<Cell<usize>>) -> Vec<Handler<'_>> {
        self.exclude_selectors
            .iter()
            .map(|selector| {
                let depth = Rc::clone(depth);
                let handler = ElementContentHandlers::default().element(move |el: &mut Element| {
                    // Void elements such as <img> never close, so counting them would hide the rest
                    // of the page
                    if let Some(end_tag_handlers) = el.end_tag_handlers() {
                        depth.set(depth.get() + 1);
                        let depth = Rc::clone(&depth);
                        end_tag_handlers.push(end_tag_handler(move |_| {
                            depth.set(depth.get() - 1);
                            Ok(())
                        }));
                    }
                    Ok(())
                });
                (Cow::Borrowed(selector), handler)
            })
            .collect()
    }

    fn link_handler<'a>(
        &'a self,
        page_url: &'a str,
        excluded_depth: &'a Cell<usize>,
        edges: &'a mut Vec<Edge>,
    ) -> Handler<'a> {
        // `set_path` cannot fail or change the host, whatever `page_url` holds
        let mut page = self.base.clone();
        page.set_path(page_url);
        let mut seen = HashSet::new();

        element!("a[href]", move |el| {
            if excluded_depth.get() > 0 {
                return Ok(());
            }
            if let Some(href) = el.get_attribute("href")
                && let Some((target, edge_type)) = self.classify(&page, &href)
                && seen.insert(target.clone())
            {
                edges.push(Edge {
                    source: page_url.to_owned(),
                    target,
                    edge_type,
                });
            }
            Ok(())
        })
    }

    fn classify(&self, page: &Url, href: &str) -> Option<(String, EdgeType)> {
        let href = href.trim();
        if href.is_empty() {
            return None;
        }
        let url = page.join(href).ok()?;
        if !matches!(url.scheme(), "http" | "https") {
            return None;
        }

        if same_site(&url, &self.base) {
            let target = normalize_html_path(url.path());
            if target == normalize_html_path(page.path()) {
                return None;
            }
            return Some((target, EdgeType::Internal));
        }

        let friend = self.friends.iter().find(|friend| same_site(&url, friend))?;
        // Rebuilt on the declared origin so a friend page has one id whatever scheme the link used
        let mut target = friend.clone();
        target.set_path(url.path());
        Some((target.into(), EdgeType::Friend))
    }
}

fn title_handlers(title: &mut String) -> Vec<Handler<'_>> {
    let done = Rc::new(Cell::new(false));
    let open = {
        let done = Rc::clone(&done);
        element!("title", move |el| {
            if !done.get()
                && let Some(end_tag_handlers) = el.end_tag_handlers()
            {
                let done = Rc::clone(&done);
                end_tag_handlers.push(end_tag_handler(move |_| {
                    done.set(true);
                    Ok(())
                }));
            }
            Ok(())
        })
    };
    let chunks = text!("title", move |chunk| {
        if !done.get() {
            title.push_str(chunk.as_str());
        }
        Ok(())
    });
    vec![open, chunks]
}

/// `lol_html` requires end-tag handlers to be `'static`, so the state they touch lives in an `Rc`.
fn end_tag_handler(
    f: impl FnOnce(&mut EndTag<'_>) -> HandlerResult + 'static,
) -> EndTagHandler<'static> {
    Box::new(f)
}

/// Node URLs and edge targets both go through here so they agree.
fn normalize_html_path(path: &str) -> String {
    if let Some(dir) = path.strip_suffix("index.html")
        && dir.ends_with('/')
    {
        return dir.to_owned();
    }
    if let Some(stem) = path.strip_suffix(".html") {
        return stem.to_owned();
    }
    path.to_owned()
}

/// Same host and port, any scheme, so `http://` links to an `https://` site stay internal.
/// [`Url::port`] returns `None` for a scheme's default port.
fn same_site(a: &Url, b: &Url) -> bool {
    a.host_str() == b.host_str() && a.port() == b.port()
}

#[cfg(test)]
mod tests {
    use super::*;

    const BASE_URL: &str = "https://alice.dev/";

    fn friends() -> Vec<String> {
        vec![
            String::from("https://bob.dev/"),
            String::from("https://carol.dev/"),
        ]
    }

    fn extractor(selectors: &[&str]) -> Extractor {
        let selectors: Vec<String> = selectors.iter().map(|s| (*s).to_owned()).collect();
        Extractor::new(BASE_URL, &friends(), &selectors).unwrap()
    }

    fn extract(html: &str, page_url: &str) -> (Node, Vec<Edge>) {
        extractor(&[]).extract_page(html, page_url).unwrap()
    }

    fn extract_excluding(html: &str, selectors: &[&str]) -> Vec<String> {
        let (_, edges) = extractor(selectors).extract_page(html, "/").unwrap();
        edges.into_iter().map(|e| e.target).collect()
    }

    #[test]
    fn classifies_hrefs() {
        use EdgeType::{Friend, Internal};

        type Case = (&'static str, &'static str, Option<(&'static str, EdgeType)>);
        let cases: &[Case] = &[
            ("/", "/about", Some(("/about", Internal))),
            ("/", "/about/index.html", Some(("/about/", Internal))),
            ("/", "/posts/hello.html", Some(("/posts/hello", Internal))),
            ("/", "/about?x=1#frag", Some(("/about", Internal))),
            ("/posts/hello", "../about", Some(("/about", Internal))),
            (
                "/posts/hello",
                "../about/index.html",
                Some(("/about/", Internal)),
            ),
            ("/posts/hello", "./other", Some(("/posts/other", Internal))),
            ("/posts/hello", "../../../about", Some(("/about", Internal))),
            ("/", "https://alice.dev/about", Some(("/about", Internal))),
            (
                "/",
                "https://alice.dev/about/index.html",
                Some(("/about/", Internal)),
            ),
            ("/", "https://ALICE.dev/about", Some(("/about", Internal))),
            ("/about", "https://alice.dev", Some(("/", Internal))),
            ("/", "http://alice.dev/about", Some(("/about", Internal))),
            ("/", "/a b.html", Some(("/a%20b", Internal))),
            ("/", "/", None),
            ("/", "#section", None),
            ("/", "?x=1", None),
            ("/posts/hello", "/posts/hello.html#top", None),
            ("/", "", None),
            ("/", "   ", None),
            ("/", "mailto:a@b.com", None),
            ("/", "MAILTO:a@b.com", None),
            ("/", "tel:+33123456789", None),
            ("/", "javascript:void(0)", None),
            ("/", "data:text/html,hi", None),
            ("/", "ftp://alice.dev/file", None),
            ("/", "sms:+33123456789", None),
            ("/", "blob:https://alice.dev/uuid", None),
            ("/", "https://bob.dev/", Some(("https://bob.dev/", Friend))),
            ("/", "https://bob.dev", Some(("https://bob.dev/", Friend))),
            ("/", "HTTPS://bob.dev/", Some(("https://bob.dev/", Friend))),
            (
                "/",
                "http://bob.dev/post",
                Some(("https://bob.dev/post", Friend)),
            ),
            (
                "/",
                "//carol.dev/post/1",
                Some(("https://carol.dev/post/1", Friend)),
            ),
            (
                "/",
                "https://carol.dev/post/1?x=1#y",
                Some(("https://carol.dev/post/1", Friend)),
            ),
            ("/", "https://random.com/", None),
            ("/", "https://bob.dev.evil.com/", None),
            ("/", "https://alice.dev:8443/about", None),
        ];

        for (page, href, expected) in cases {
            let html = format!("<html><body><a href=\"{href}\">x</a></body></html>");
            let (_, edges) = extract(&html, page);
            let actual: Vec<(&str, EdgeType)> = edges
                .iter()
                .map(|e| (e.target.as_str(), e.edge_type.clone()))
                .collect();
            let expected: Vec<(&str, EdgeType)> = expected.clone().into_iter().collect();
            assert_eq!(actual, expected, "page {page}, href {href:?}");
        }
    }

    #[test]
    fn edges_carry_the_page_as_source() {
        let (_, edges) = extract(r#"<a href="/about">About</a>"#, "/posts/hello");
        assert_eq!(edges[0].source, "/posts/hello");
    }

    #[test]
    fn deduplicates_targets_within_a_page() {
        let html = r#"
            <a href="/about">About</a>
            <a href="/about.html">About again</a>
            <a href="https://alice.dev/about?x=1">About once more</a>
        "#;
        let (_, edges) = extract(html, "/");
        assert_eq!(edges.len(), 1);
        assert_eq!(edges[0].target, "/about");
    }

    #[test]
    fn captures_first_title_trimmed() {
        let html = r#"
            <html><head><title>
                My Page Title
            </title></head>
            <body><svg><title>Icon</title></svg></body></html>
        "#;
        let (node, _) = extract(html, "/page");
        assert_eq!(node.title, "My Page Title");
    }

    #[test]
    fn title_falls_back_to_page_url() {
        let (node, _) = extract(
            r#"<html><body><a href="/about">link</a></body></html>"#,
            "/page",
        );
        assert_eq!(node.title, "/page");
    }

    #[test]
    fn excluded_selectors_skip_nested_links() {
        let html = r#"
            <nav><a href="/hidden">Hidden</a></nav>
            <main><a href="/visible">Visible</a></main>
            <footer><div><a href="/also-hidden">Also hidden</a></div></footer>
            <a class="skip" href="/self-match">Skip</a>
        "#;
        let targets = extract_excluding(html, &["nav", "footer", ".skip"]);
        assert_eq!(targets, vec!["/visible"]);
    }

    #[test]
    fn excluded_void_elements_do_not_swallow_later_links() {
        for html in [
            r#"<img src="x.png"><a href="/after">After</a>"#,
            r#"<br><a href="/after">After</a>"#,
            r#"<hr><a href="/after">After</a>"#,
        ] {
            let targets = extract_excluding(html, &["img", "br", "hr"]);
            assert_eq!(targets, vec!["/after"], "html: {html}");
        }
    }

    #[test]
    fn rejects_invalid_css_selector() {
        let err = Extractor::new(BASE_URL, &[], &[String::from("a]")]).unwrap_err();
        assert!(
            matches!(err, Error::InvalidSelector { ref selector, .. } if selector == "a]"),
            "got {err:?}"
        );
    }

    #[test]
    fn rejects_friend_with_a_path() {
        let err =
            Extractor::new(BASE_URL, &[String::from("https://bob.dev/blog/")], &[]).unwrap_err();
        assert!(matches!(err, Error::InvalidFriendUrl { .. }), "got {err:?}");
    }

    #[test]
    fn url_for_file_normalizes_and_encodes() {
        let extractor = extractor(&[]);
        let cases = [
            ("index.html", "/"),
            ("about/index.html", "/about/"),
            ("posts/hello.html", "/posts/hello"),
            ("myindex.html", "/myindex"),
            ("a b/c d.html", "/a%20b/c%20d"),
            ("notes.htm", "/notes.htm"),
            ("c#.html", "/c%23"),
            ("q?.html", "/q%3F"),
            ("\\evil.html", "/%5Cevil"),
        ];
        for (path, expected) in cases {
            assert_eq!(extractor.url_for_file(path), expected, "path {path}");
        }
    }

    #[test]
    fn extract_page_accepts_odd_page_urls() {
        let (node, edges) = extractor(&[]).extract_page("", "\\[").unwrap();
        assert_eq!(node.url, "\\[");
        assert!(edges.is_empty());
    }
}
