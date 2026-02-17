use std::borrow::Cow;
use std::cell::{Cell, RefCell};
use std::collections::HashSet;
use std::rc::Rc;

use lol_html::html_content::{Element, EndTag};
use lol_html::{
    ElementContentHandlers, EndTagHandler, HandlerResult, RewriteStrSettings, element, rewrite_str,
    text,
};

use crate::error::{Error, Result};
use crate::model::{Edge, EdgeType, Node};

/// Helper to build an end-tag handler with the correct `Box<dyn FnOnce>` type.
fn end_tag_handler(
    f: impl FnOnce(&mut EndTag<'_>) -> HandlerResult + 'static,
) -> EndTagHandler<'static> {
    Box::new(f)
}

/// Extracts a page node and its outgoing edges from HTML content.
///
/// Links inside elements matching `exclude_selectors` are ignored.
/// External links that don't match any friend URL are dropped.
pub fn extract_page(
    html: &str,
    page_url: &str,
    base_url: &str,
    friends: &[String],
    exclude_selectors: &[String],
) -> Result<(Node, Vec<Edge>)> {
    let title_text = Rc::new(RefCell::new(String::new()));
    let title_done = Rc::new(Cell::new(false));
    let excluded_depth = Rc::new(Cell::new(0usize));
    let collected_edges = Rc::new(RefCell::new(Vec::<Edge>::new()));
    let seen_targets = Rc::new(RefCell::new(HashSet::<String>::new()));

    let mut handlers: Vec<(Cow<lol_html::Selector>, ElementContentHandlers)> = Vec::new();

    // Mark end of first <title> so we only capture the first occurrence
    {
        let done = Rc::clone(&title_done);
        handlers.push(element!("title", move |el| {
            if !done.get() {
                let d = Rc::clone(&done);
                if let Some(handlers) = el.end_tag_handlers() {
                    handlers.push(end_tag_handler(move |_| {
                        d.set(true);
                        Ok(())
                    }));
                }
            }
            Ok(())
        }));
    }

    // Accumulate text chunks inside the first <title>
    {
        let text_buf = Rc::clone(&title_text);
        let done = Rc::clone(&title_done);
        handlers.push(text!("title", move |chunk| {
            if !done.get() {
                text_buf.borrow_mut().push_str(chunk.as_str());
            }
            Ok(())
        }));
    }

    // Depth counter for excluded CSS selectors — links inside are skipped
    for selector_str in exclude_selectors {
        let selector = selector_str.parse::<lol_html::Selector>().map_err(|err| {
            Error::HtmlParse(format!("invalid CSS selector '{selector_str}': {err}"))
        })?;
        let depth = Rc::clone(&excluded_depth);
        handlers.push((
            Cow::Owned(selector),
            ElementContentHandlers::default().element(move |el: &mut Element| {
                depth.set(depth.get() + 1);
                let d = Rc::clone(&depth);
                if let Some(h) = el.end_tag_handlers() {
                    h.push(end_tag_handler(move |_| {
                        d.set(d.get() - 1);
                        Ok(())
                    }));
                }
                Ok(())
            }),
        ));
    }

    // Collect <a href="..."> links, deduplicating by target
    {
        let depth = Rc::clone(&excluded_depth);
        let edges = Rc::clone(&collected_edges);
        let seen = Rc::clone(&seen_targets);
        let page = page_url.to_owned();
        let base = base_url.to_owned();
        let friends_owned = friends.to_vec();

        handlers.push(element!("a[href]", move |el| {
            if depth.get() > 0 {
                return Ok(());
            }
            if let Some(href) = el.get_attribute("href")
                && let Some((target, edge_type)) =
                    classify_href(&href, &page, &base, &friends_owned)
                && seen.borrow_mut().insert(target.clone())
            {
                edges.borrow_mut().push(Edge {
                    source: page.clone(),
                    target,
                    edge_type,
                });
            }
            Ok(())
        }));
    }

    rewrite_str(
        html,
        RewriteStrSettings {
            element_content_handlers: handlers,
            ..RewriteStrSettings::new()
        },
    )
    .map_err(|err| Error::HtmlParse(err.to_string()))?;

    let title = {
        let t = title_text.borrow();
        let trimmed = t.trim();
        if trimmed.is_empty() {
            page_url.to_owned()
        } else {
            trimmed.to_owned()
        }
    };

    let node = Node {
        url: page_url.to_owned(),
        title,
    };

    let edges = Rc::try_unwrap(collected_edges)
        .expect("all handler references are dropped after rewrite_str")
        .into_inner();

    Ok((node, edges))
}

// ---------------------------------------------------------------------------
// URL classification helpers
// ---------------------------------------------------------------------------

/// Classifies an href as internal, friend, or external (dropped).
fn classify_href(
    href: &str,
    page_url: &str,
    base_url: &str,
    friends: &[String],
) -> Option<(String, EdgeType)> {
    let href = href.trim();

    if href.is_empty()
        || href.starts_with('#')
        || href.starts_with('?')
        || href.starts_with("mailto:")
        || href.starts_with("tel:")
        || href.starts_with("javascript:")
        || href.starts_with("data:")
    {
        return None;
    }

    // Protocol-relative URL — treat as https
    if href.starts_with("//") {
        let absolute = format!("https:{href}");
        return classify_absolute_url(&absolute, base_url, friends);
    }

    if href.starts_with("http://") || href.starts_with("https://") {
        return classify_absolute_url(href, base_url, friends);
    }

    // Absolute path
    if href.starts_with('/') {
        let clean = strip_query_and_fragment(href);
        let normalized = normalize_internal_path(clean);
        return Some((normalized, EdgeType::Internal));
    }

    // Relative path — resolve against the current page
    let clean = strip_query_and_fragment(href);
    let resolved = resolve_relative_url(page_url, clean);
    let normalized = normalize_internal_path(&resolved);
    Some((normalized, EdgeType::Internal))
}

fn classify_absolute_url(
    href: &str,
    base_url: &str,
    friends: &[String],
) -> Option<(String, EdgeType)> {
    let clean = strip_query_and_fragment(href);
    let base = base_url.trim_end_matches('/');

    // Internal: same origin
    if clean == base {
        return Some((String::from("/"), EdgeType::Internal));
    }
    if let Some(rest) = clean.strip_prefix(base)
        && rest.starts_with('/')
    {
        let normalized = normalize_internal_path(rest);
        return Some((normalized, EdgeType::Internal));
    }

    // Friend: matches a friend base URL
    for friend in friends {
        let friend_base = friend.trim_end_matches('/');
        if clean == friend_base
            || clean
                .strip_prefix(friend_base)
                .is_some_and(|rest| rest.starts_with('/'))
        {
            return Some((clean.to_owned(), EdgeType::Friend));
        }
    }

    // External non-friend link — drop
    None
}

/// Normalizes internal paths to match the URL form produced by `file_path_to_url`.
/// Without this, edge targets like `/about/index.html` would never match node URLs.
fn normalize_internal_path(path: &str) -> String {
    if path.ends_with("/index.html") {
        let mut result = path[..path.len() - "index.html".len()].to_owned();
        if result.is_empty() {
            result.push('/');
        }
        return result;
    }
    if let Some(stripped) = path.strip_suffix(".html") {
        return stripped.to_owned();
    }
    path.to_owned()
}

fn strip_query_and_fragment(url: &str) -> &str {
    let end = url.find(['?', '#']).unwrap_or(url.len());
    &url[..end]
}

/// Resolves a relative URL path against a page URL's directory.
fn resolve_relative_url(page_url: &str, href: &str) -> String {
    let dir = match page_url.rfind('/') {
        Some(pos) => &page_url[..=pos],
        None => "/",
    };

    let mut segments: Vec<&str> = dir.split('/').filter(|s| !s.is_empty()).collect();

    for part in href.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                segments.pop();
            }
            other => segments.push(other),
        }
    }

    if segments.is_empty() {
        String::from("/")
    } else {
        format!("/{}", segments.join("/"))
    }
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

    #[test]
    fn extract_internal_links() {
        let html = r#"
            <html><head><title>Home</title></head>
            <body>
                <a href="/about">About</a>
                <a href="/posts/hello">Hello</a>
            </body></html>
        "#;

        let (node, edges) = extract_page(html, "/", BASE_URL, &friends(), &[]).unwrap();

        assert_eq!(node.url, "/");
        assert_eq!(node.title, "Home");
        assert_eq!(edges.len(), 2);
        assert!(edges.iter().all(|e| e.edge_type == EdgeType::Internal));
        assert!(edges.iter().any(|e| e.target == "/about"));
        assert!(edges.iter().any(|e| e.target == "/posts/hello"));
    }

    #[test]
    fn extract_friend_links() {
        let html = r#"
            <html><head><title>Home</title></head>
            <body>
                <a href="https://bob.dev/">Bob</a>
                <a href="https://carol.dev/post/1">Carol's post</a>
            </body></html>
        "#;

        let (_, edges) = extract_page(html, "/", BASE_URL, &friends(), &[]).unwrap();

        assert_eq!(edges.len(), 2);
        assert!(edges.iter().all(|e| e.edge_type == EdgeType::Friend));
    }

    #[test]
    fn extract_drops_external_links() {
        let html = r#"
            <html><head><title>Home</title></head>
            <body>
                <a href="/about">About</a>
                <a href="https://random.com/">Random</a>
                <a href="https://other.org/page">Other</a>
            </body></html>
        "#;

        let (_, edges) = extract_page(html, "/", BASE_URL, &friends(), &[]).unwrap();

        assert_eq!(edges.len(), 1);
        assert_eq!(edges[0].target, "/about");
        assert_eq!(edges[0].edge_type, EdgeType::Internal);
    }

    #[test]
    fn extract_excluded_selectors() {
        let html = r#"
            <html><head><title>Home</title></head>
            <body>
                <nav><a href="/hidden">Hidden</a></nav>
                <main><a href="/visible">Visible</a></main>
                <footer><a href="/also-hidden">Also hidden</a></footer>
            </body></html>
        "#;

        let selectors = vec![String::from("nav"), String::from("footer")];
        let (_, edges) = extract_page(html, "/", BASE_URL, &friends(), &selectors).unwrap();

        assert_eq!(edges.len(), 1);
        assert_eq!(edges[0].target, "/visible");
    }

    #[test]
    fn extract_title() {
        let html = r#"
            <html><head><title>My Page Title</title></head>
            <body></body></html>
        "#;

        let (node, _) = extract_page(html, "/page", BASE_URL, &friends(), &[]).unwrap();

        assert_eq!(node.title, "My Page Title");
    }

    #[test]
    fn extract_title_fallback() {
        let html = "<html><body><a href=\"/about\">link</a></body></html>";

        let (node, _) = extract_page(html, "/page", BASE_URL, &friends(), &[]).unwrap();

        assert_eq!(node.title, "/page");
    }

    #[test]
    fn extract_deduplication() {
        let html = r#"
            <html><head><title>Home</title></head>
            <body>
                <a href="/about">About</a>
                <a href="/about">About again</a>
                <a href="/about">About once more</a>
            </body></html>
        "#;

        let (_, edges) = extract_page(html, "/", BASE_URL, &friends(), &[]).unwrap();

        assert_eq!(edges.len(), 1);
        assert_eq!(edges[0].target, "/about");
    }

    #[test]
    fn extract_relative_link() {
        let html = r#"
            <html><head><title>Post</title></head>
            <body><a href="../about">About</a></body></html>
        "#;

        let (_, edges) = extract_page(html, "/posts/hello", BASE_URL, &friends(), &[]).unwrap();

        assert_eq!(edges.len(), 1);
        assert_eq!(edges[0].target, "/about");
        assert_eq!(edges[0].edge_type, EdgeType::Internal);
    }

    #[test]
    fn extract_absolute_url_matching_base() {
        let html = r#"
            <html><head><title>Home</title></head>
            <body><a href="https://alice.dev/about">About</a></body></html>
        "#;

        let (_, edges) = extract_page(html, "/", BASE_URL, &friends(), &[]).unwrap();

        assert_eq!(edges.len(), 1);
        assert_eq!(edges[0].target, "/about");
        assert_eq!(edges[0].edge_type, EdgeType::Internal);
    }

    #[test]
    fn extract_drops_fragment_only_and_special_schemes() {
        let html = r##"
            <html><head><title>Home</title></head>
            <body>
                <a href="#section">Fragment</a>
                <a href="mailto:a@b.com">Email</a>
                <a href="javascript:void(0)">JS</a>
                <a href="/real">Real</a>
            </body></html>
        "##;

        let (_, edges) = extract_page(html, "/", BASE_URL, &friends(), &[]).unwrap();

        assert_eq!(edges.len(), 1);
        assert_eq!(edges[0].target, "/real");
    }

    #[test]
    fn extract_normalizes_internal_index_html() {
        let html = r#"
            <html><head><title>Home</title></head>
            <body><a href="/about/index.html">About</a></body></html>
        "#;

        let (_, edges) = extract_page(html, "/", BASE_URL, &friends(), &[]).unwrap();

        assert_eq!(edges.len(), 1);
        assert_eq!(edges[0].target, "/about/");
        assert_eq!(edges[0].edge_type, EdgeType::Internal);
    }

    #[test]
    fn extract_normalizes_internal_html_extension() {
        let html = r#"
            <html><head><title>Home</title></head>
            <body><a href="/posts/hello.html">Hello</a></body></html>
        "#;

        let (_, edges) = extract_page(html, "/", BASE_URL, &friends(), &[]).unwrap();

        assert_eq!(edges.len(), 1);
        assert_eq!(edges[0].target, "/posts/hello");
        assert_eq!(edges[0].edge_type, EdgeType::Internal);
    }

    #[test]
    fn extract_normalizes_absolute_url_with_html_extension() {
        let html = r#"
            <html><head><title>Home</title></head>
            <body><a href="https://alice.dev/about/index.html">About</a></body></html>
        "#;

        let (_, edges) = extract_page(html, "/", BASE_URL, &friends(), &[]).unwrap();

        assert_eq!(edges.len(), 1);
        assert_eq!(edges[0].target, "/about/");
        assert_eq!(edges[0].edge_type, EdgeType::Internal);
    }

    #[test]
    fn extract_normalizes_relative_html_link() {
        let html = r#"
            <html><head><title>Post</title></head>
            <body><a href="../about/index.html">About</a></body></html>
        "#;

        let (_, edges) = extract_page(html, "/posts/hello", BASE_URL, &friends(), &[]).unwrap();

        assert_eq!(edges.len(), 1);
        assert_eq!(edges[0].target, "/about/");
        assert_eq!(edges[0].edge_type, EdgeType::Internal);
    }

    #[test]
    fn extract_query_only_href_produces_no_edge() {
        let html = r#"
            <html><head><title>Home</title></head>
            <body><a href="?x=1">Query only</a></body></html>
        "#;

        let (_, edges) = extract_page(html, "/", BASE_URL, &friends(), &[]).unwrap();

        assert!(edges.is_empty());
    }
}
