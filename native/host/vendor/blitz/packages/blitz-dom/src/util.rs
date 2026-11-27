use crate::node::{Node, NodeData};
use color::{AlphaColor, Srgb};
use keyboard_types::Modifiers;
use std::borrow::Cow;
use style::color::AbsoluteColor;

#[cfg(target_os = "macos")]
pub(crate) const ACTION_MOD: Modifiers = Modifiers::SUPER;
#[cfg(not(target_os = "macos"))]
pub(crate) const ACTION_MOD: Modifiers = Modifiers::CONTROL;

pub type Color = AlphaColor<Srgb>;

/// Decode raw font bytes, decompressing WOFF/WOFF2 if the `woff` feature is enabled.
/// Returns the original slice unchanged for TTF/OTF input, and also on decompression
/// failure. With the `woff` feature disabled, all input passes through unchanged.
pub fn decode_font_bytes(bytes: &[u8]) -> Cow<'_, [u8]> {
    if bytes.len() < 4 {
        return Cow::Borrowed(bytes);
    }
    match &bytes[0..4] {
        #[cfg(feature = "woff")]
        b"wOFF" => wuff::decompress_woff1(bytes)
            .map(Cow::Owned)
            .unwrap_or_else(|_| {
                #[cfg(feature = "tracing")]
                tracing::warn!("Failed to decompress woff1 font");
                Cow::Borrowed(bytes)
            }),
        #[cfg(feature = "woff")]
        b"wOF2" => wuff::decompress_woff2(bytes)
            .map(Cow::Owned)
            .unwrap_or_else(|_| {
                #[cfg(feature = "tracing")]
                tracing::warn!("Failed to decompress woff2 font");
                Cow::Borrowed(bytes)
            }),
        _ => Cow::Borrowed(bytes),
    }
}

/// [fork] BLITZ_LEGACY_RESOLVE=1 (an A/B switch, off by default): every resolve does the whole pass (no
/// `needs_resolve` early-out), ticks CSS animations whatever the clock, and measures the paint damage itself, with a
/// filtered element's damage the whole window, as before the frame-clocked resolve. Read once.
pub fn legacy_resolve() -> bool {
    static ON: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *ON.get_or_init(|| std::env::var("BLITZ_LEGACY_RESOLVE").as_deref() == Ok("1"))
}

/// [fork] BLITZ_LEGACY_SVG=1 (an A/B switch, off by default): system font faces are not shared (each access maps
/// the file) and a changed inline `<svg>` is parsed twice a resolve, as before. Read once.
pub fn legacy_svg() -> bool {
    static ON: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *ON.get_or_init(|| std::env::var("BLITZ_LEGACY_SVG").as_deref() == Ok("1"))
}

#[cfg(feature = "svg")]
use std::sync::{Arc, LazyLock};
#[cfg(feature = "svg")]
use usvg::fontdb;
#[cfg(feature = "svg")]
pub(crate) static FONT_DB: LazyLock<Arc<fontdb::Database>> = LazyLock::new(|| {
    let mut db = fontdb::Database::new();
    db.load_system_fonts();
    // [fork] Each font file mapped once, here, and its faces shared: a system face is otherwise a path, opened and
    // mapped (NtCreateFile, NtCreateSection) on every access, and usvg turns an inline SVG's `<text>` into outlines
    // through it at every parse: a map's four letters cost 2.6 ms a parse, 0.17 ms shared (about 16 ms once
    // for every system face).
    let ids: Vec<fontdb::ID> = if legacy_svg() { Vec::new() } else { db.faces().map(|face| face.id).collect() };
    for id in ids {
        // SAFETY: the mapping is read-only; a system font file is not rewritten while the program runs (fontdb's
        // caveat: another process changing the file would show through the mapping).
        unsafe {
            db.make_shared_face_data(id);
        }
    }
    Arc::new(db)
});

/// Which kind of CSS image layer list (`background-image` or `mask-image`) to
/// flush from style to dedicated storage on the node.
#[derive(Clone, Copy, Debug)]
pub enum ImageLayerKind {
    Background,
    Mask,
    /// [fork] `border-image-source` (a list of one).
    BorderImage,
    /// [fork] `mask-border-source` (a list of one).
    MaskBorder,
}

impl ImageLayerKind {
    pub fn image_type(self, idx: usize) -> ImageType {
        match self {
            Self::Background => ImageType::Background(idx),
            Self::Mask => ImageType::Mask(idx),
            Self::BorderImage => ImageType::BorderImage,
            Self::MaskBorder => ImageType::MaskBorder,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub enum ImageType {
    Image,
    Background(usize),
    Mask(usize),
    /// [fork] The element's `border-image-source`.
    BorderImage,
    /// [fork] The element's `mask-border-source`.
    MaskBorder,
}

/// A point
#[derive(Clone, Debug, Copy, Eq, PartialEq)]
pub struct Point<T> {
    /// The x coordinate
    pub x: T,
    /// The y coordinate
    pub y: T,
}

impl Point<f64> {
    pub const ZERO: Self = Point { x: 0.0, y: 0.0 };
}

// Debug print an RcDom
pub fn walk_tree(indent: usize, node: &Node) {
    // Skip all-whitespace text nodes entirely
    if let NodeData::Text(data) = &node.data {
        if data.content.chars().all(|c| c.is_ascii_whitespace()) {
            return;
        }
    }

    print!("{}", " ".repeat(indent));
    let id = node.id;
    match &node.data {
        NodeData::Document(_) => println!("#Document {id}"),

        NodeData::Text(data) => {
            if data.content.chars().all(|c| c.is_ascii_whitespace()) {
                println!("{id} #text: <whitespace>");
            } else {
                let content = data.content.trim();
                if content.len() > 10 {
                    println!(
                        "#text {id}: {}...",
                        content
                            .split_at(content.char_indices().take(10).last().unwrap().0)
                            .0
                            .escape_default()
                    )
                } else {
                    println!("#text {id}: {}", data.content.trim().escape_default())
                }
            }
        }

        NodeData::Comment { .. } => println!("<!-- COMMENT {id} -->"),

        NodeData::AnonymousBlock(_) => println!("{id} AnonymousBlock"),

        NodeData::Element(data) => {
            print!("<{} {id}", data.name.local);
            for attr in data.attrs.iter() {
                print!(" {}=\"{}\"", attr.name.local, attr.value);
            }
            if !node.children.is_empty() {
                println!(">");
            } else {
                println!("/>");
            }
        } // NodeData::Doctype {
          //     ref name,
          //     ref public_id,
          //     ref system_id,
          // } => println!("<!DOCTYPE {} \"{}\" \"{}\">", name, public_id, system_id),
          // NodeData::ProcessingInstruction { .. } => unreachable!(),
    }

    if !node.children.is_empty() {
        for child_id in node.children.iter() {
            walk_tree(indent + 2, node.with(*child_id));
        }

        if let NodeData::Element(data) = &node.data {
            println!("{}</{}>", " ".repeat(indent), data.name.local);
        }
    }
}

/// Parse an SVG image.
#[cfg(feature = "svg")]
/// [fork] Where an inline SVG's root-relative image hrefs (`<image href="/maps/x.webp">`) are read from:
/// the embedder's document root (`set_svg_resource_root`). usvg resolves hrefs against the file system only.
#[cfg(feature = "svg")]
static SVG_RESOURCE_ROOT: std::sync::RwLock<Option<std::path::PathBuf>> = std::sync::RwLock::new(None);

/// [fork] Sets the directory an inline SVG's `/path` and same-origin `http(s)://host/path` image hrefs read from.
#[cfg(feature = "svg")]
pub fn set_svg_resource_root(root: Option<std::path::PathBuf>) {
    *SVG_RESOURCE_ROOT.write().unwrap() = root;
}

/// [fork] An embedder's reader for an inline SVG's root-relative image hrefs: given the path (`/maps/x.webp`),
/// its bytes, or None. Set, it is used in place of the root's files (a host whose document root is not all on disk:
/// files it carries, files it streams).
#[cfg(feature = "svg")]
pub type SvgResourceLoader = Arc<dyn Fn(&str) -> Option<Vec<u8>> + Send + Sync>;

#[cfg(feature = "svg")]
static SVG_RESOURCE_LOADER: std::sync::RwLock<Option<SvgResourceLoader>> = std::sync::RwLock::new(None);

/// [fork] Sets the reader an inline SVG's `/path` and same-origin `http(s)://host/path` image hrefs read through.
#[cfg(feature = "svg")]
pub fn set_svg_resource_loader(loader: Option<SvgResourceLoader>) {
    *SVG_RESOURCE_LOADER.write().unwrap() = loader;
}

#[cfg(feature = "svg")]
pub(crate) fn parse_svg_image(source: &[u8]) -> Result<crate::node::SvgImageData, usvg::Error> {
    let mut options = usvg::Options {
        fontdb: Arc::clone(&*FONT_DB),
        ..Default::default()
    };
    let fallback = usvg::ImageHrefResolver::default_string_resolver();
    options.image_href_resolver.resolve_string = Box::new(move |href: &str, opts: &usvg::Options| {
        let root = SVG_RESOURCE_ROOT.read().unwrap().clone();
        let loader = SVG_RESOURCE_LOADER.read().unwrap().clone();
        let path = href.split(['?', '#']).next().unwrap_or("");
        let path = match path.split_once("://") {
            Some((_, rest)) => rest.find('/').map_or("", |i| &rest[i..]),
            None => path,
        };
        if let Some(relative) = path.strip_prefix('/')
            && (loader.is_some() || root.is_some())
        {
            // One buffer per file, shared by every parse: a re-parsed <svg> (its markers moved) hands the renderer
            // the same image, which it decoded once.
            static FILES: std::sync::Mutex<Option<std::collections::HashMap<std::path::PathBuf, Arc<Vec<u8>>>>> = std::sync::Mutex::new(None);
            let file = match (&loader, &root) {
                (None, Some(root)) => root.join(relative),
                _ => std::path::PathBuf::from(path),
            };
            let known = FILES.lock().unwrap().get_or_insert_with(Default::default).get(&file).cloned();
            let data = match known {
                Some(data) => data,
                None => {
                    // Read without the lock: a loader may go to the network.
                    let read = match &loader {
                        Some(load) => load(path).ok_or_else(|| "not found".to_string()),
                        None => std::fs::read(&file).map_err(|e| e.to_string()),
                    };
                    if std::env::var_os("BLITZ_SVG_TRACE").is_some() {
                        eprintln!("svg image {href}: {}", read.as_ref().map_or_else(|e| e.clone(), |d| format!("{} bytes", d.len())));
                    }
                    let data = Arc::new(read.ok()?);
                    FILES.lock().unwrap().get_or_insert_with(Default::default).insert(file, data.clone());
                    data
                }
            };
            return (usvg::ImageHrefResolver::default_data_resolver())("text/plain", data, opts);
        }
        fallback(href, opts)
    });
    crate::node::SvgImageData::from_data(source, &options)
}

pub trait ToColorColor {
    /// Converts a color into the `AlphaColor<Srgb>` type from the `color` crate
    fn as_color_color(&self) -> Color;
}
impl ToColorColor for AbsoluteColor {
    fn as_color_color(&self) -> Color {
        Color::new(
            *self
                .to_color_space(style::color::ColorSpace::Srgb)
                .raw_components(),
        )
    }
}

#[cfg(all(test, feature = "svg"))]
mod svg_tests {
    use super::parse_svg_image;

    #[test]
    fn svg_without_xmlns_parses() {
        let src = br#"<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>"#;
        let svg = parse_svg_image(src).unwrap();
        assert!(!svg.tree.root().children().is_empty());
    }

    #[test]
    fn missing_height_is_computed_from_width_and_viewbox_ratio() {
        let src = br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="200"><rect width="100%" height="100%" fill="green"/></svg>"#;
        let svg = parse_svg_image(src).unwrap();
        assert_eq!(svg.intrinsic_width(), Some(200.0));
        assert_eq!(svg.intrinsic_height(), None);
        assert_eq!(svg.viewbox_aspect_ratio(), Some(1.0));
        assert_eq!(svg.tree.size().width(), 200.0);
        assert_eq!(svg.intrinsic_size(), (200.0, 200.0));
    }

    #[test]
    fn viewbox_only_has_no_intrinsic_dimensions() {
        let src = br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 485 58"></svg>"#;
        let svg = parse_svg_image(src).unwrap();
        assert_eq!(svg.intrinsic_width(), None);
        assert_eq!(svg.intrinsic_height(), None);
        // The aspect ratio is still available from the viewBox.
        assert!((svg.aspect_ratio() - (485.0 / 58.0)).abs() < 1e-3);
    }

    #[test]
    fn absolute_dimensions_are_intrinsic() {
        let src = br#"<svg xmlns="http://www.w3.org/2000/svg" width="24" height="16" viewBox="0 0 48 32"></svg>"#;
        let svg = parse_svg_image(src).unwrap();
        assert_eq!(svg.intrinsic_width(), Some(24.0));
        assert_eq!(svg.intrinsic_height(), Some(16.0));
    }

    #[test]
    fn percentage_dimensions_are_not_intrinsic() {
        let src = br#"<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="50%" viewBox="0 0 200 100"></svg>"#;
        let svg = parse_svg_image(src).unwrap();
        assert_eq!(svg.intrinsic_width(), None);
        assert_eq!(svg.intrinsic_height(), None);
    }

    #[test]
    fn unit_lengths_are_intrinsic() {
        let src = br#"<svg xmlns="http://www.w3.org/2000/svg" width="24px" height="1.5em" viewBox="0 0 48 32"></svg>"#;
        let svg = parse_svg_image(src).unwrap();
        assert!(svg.intrinsic_width().is_some());
        assert!(svg.intrinsic_height().is_some());
    }

    #[test]
    fn non_numeric_dimensions_are_not_intrinsic() {
        let src = br#"<svg xmlns="http://www.w3.org/2000/svg" width="auto" height="foo" viewBox="0 0 200 100"></svg>"#;
        let svg = parse_svg_image(src).unwrap();
        assert_eq!(svg.intrinsic_width(), None);
        assert_eq!(svg.intrinsic_height(), None);
    }
}

/// Creates an markup5ever::QualName.
/// Given a local name and an optional namespace
#[macro_export]
macro_rules! qual_name {
    ($local:tt $(, $ns:ident)?) => {
        $crate::QualName {
            prefix: None,
            ns: $crate::ns!($($ns)?),
            local: $crate::local_name!($local),
        }
    };
}
