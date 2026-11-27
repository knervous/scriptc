//! min-height through a custom property with a viewport-unit value.
use blitz_ui::UiDocument;

fn height(css: &str) -> f32 {
    let html = format!("<html><head><style>{css}</style></head><body style=\"margin:0\"><div id=\"root\"><main id=\"m\" class=\"app\">x</main></div></body></html>");
    let mut ui = UiDocument::new(&html, "file:///tmp/", 1280, 720, 1.0);
    ui.render();
    let id = ui.by_id("m").unwrap();
    ui.document().get_client_bounding_rect(blitz_dom::NodeId::from_u64(id)).unwrap().height as f32
}

#[test]
fn var_viewport_min_height() {
    for css in [
        ".app { min-height: 100vh; }",
        ".app { min-height: 100svh; }",
        ".app { min-height: var(--h, 100svh); }",
        ":root { --h: 100vh; } .app { min-height: var(--h, 100svh); }",
        ":root { --h: 100vh; } html, body { height: 100%; } .app { min-height: var(--h, 100svh); }",
    ] {
        eprintln!("{:>8.1}  {css}", height(css));
    }
}
