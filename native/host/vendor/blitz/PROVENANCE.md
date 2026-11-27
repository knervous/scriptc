# Blitz (vendored)

Source: https://github.com/DioxusLabs/blitz at e72650a6e67941852fddf025295cfee30c39ea32
(the revision every native crate names), MIT OR Apache-2.0 (LICENSE-MIT,
LICENSE-APACHE). Only the packages the native workspace uses are here
(blitz-dom, blitz-html, blitz-net, blitz-paint, blitz-traits, stylo_taffy,
debug_timer, accesskit_xplat); the workspace manifest lists just those.
native/Cargo.toml's `[patch."https://github.com/DioxusLabs/blitz"]` points the
git dependency at these copies. vendor/blitz-vibey-script is a separate copy.

This fork's changes are marked `[fork]`; each is meant to go upstream:

- blitz-dom document.rs `apply_loaded_image`: a background or mask image arriving inserts paint damage on
  its element, as an `<img>` does; a host repainting by damage showed it only when something else did.
- blitz-dom document.rs: `layout.css.has-selector.enabled`, so Stylo parses `:has()`. Without it every
  rule using `:has()` was dropped (a splash hidden by `body:has(#root > *) #splash` never hid).
- blitz-dom mutator.rs `invalidate_relative_selector_anchors`: inserting or removing children under (or
  beside) an element Stylo flagged ANCHORS_RELATIVE_SELECTOR restyles the anchor's parent's subtree, so a
  `:has()` that depends on the change rematches. Was: only the changed parent's subtree restyled.
- blitz-net Cargo.toml: reqwest's `rustls` (the platform certificate verifier) on every
  platform, in place of `native-tls` (and `native-tls-vendored` on Android): no OpenSSL to
  cross-build for Android or Linux.
- blitz-dom mutator.rs: attribute changes invalidate as browsers do
  (`invalidate_attribute_change`): Stylo's snapshot invalidation decides which
  elements restyle and the restyle's style diff decides layout and paint;
  presentational attributes restyle the element itself; attributes that change
  content outside CSS relay it out; setting an attribute's current value, or
  removing an absent one, does nothing. Was: the element's and its parent's
  subtrees restyled and the element relaid out on every change.
- blitz-dom document.rs `snapshot_node_for_attr` (called by `invalidate_attribute_change`): the
  snapshot lists the changed attribute among its `changed_attrs`, which held only the attributes
  the element already had; an attribute being added was never looked up in Stylo's attribute
  dependencies, so `html[data-x] .y` did not restyle `.y` when `data-x` appeared.
- blitz-dom util.rs `set_svg_resource_loader`: an embedder's reader for an inline SVG's root-relative image hrefs, in
  place of `set_svg_resource_root`'s files (scriptc-host: files it carries in the executable, files it streams).
- blitz-dom document.rs `get_cursor_images`: the hovered node's `cursor` images (a url(), or an
  image-set()'s selected candidate with its resolution) and
  hotspots, for the host to make the cursor from (scriptc-host window_windows.rs).
- blitz-dom layout/damage.rs: `invalidate_everything` (a full restyle and
  relayout on the next resolve), the reference blitz-profile --verify compares
  an incremental render with.
- blitz-dom layout/paint_damage.rs (+ fields in document.rs, calls in resolve.rs): paint
  damage. A host opts in with `track_paint_damage`; each resolve that changed anything
  compares every element's screen rectangle (border box grown by shadows, outlines and
  text shadows, through transforms and scroll offsets) with the last frame's, and
  `take_paint_damage` answers the regions to repaint (or the whole window: the first
  frame, a new viewport or scroll, a filtered element, most of the window).
- blitz-paint lib.rs/render.rs: `paint_scene_region` paints one region of the document
  into a region-sized target (render.rs `clip_origin` culls to it).
- blitz-dom layout/paint_damage.rs: `BLITZ_DAMAGE_TRACE=1` names each frame's damaged
  elements and why a frame went whole (debugging).
- blitz-paint render/box_shadow.rs (+ `NonUniformRoundedRectRadii::max`): an inset
  shadow's layer clips to the ring between the padding box and the interior where the
  shadow is under a thousandth of its colour (three standard deviations, the corner
  radius and 1.5 px in from the hole), so a renderer skips the interior's tiles. Output
  unchanged (at most 1 level on the render corpus, vello_cpu and Vello GPU); a panel-heavy page's
  GPU time on Vello at 2x 12.2 -> 9.1 ms.
- blitz-paint render/border_image.rs (+ blitz-dom `border_images`, `ImageType::BorderImage`): `border-image`
  (raster and gradient sources, slice with `fill`, width, outset, stretch/repeat/round/space), drawn in place of
  the border styles once ready.
- blitz-paint render/mask.rs (+ blitz-dom `mask_border_images`): `mask-border` / `-webkit-mask-box-image` (vendored
  stylo), the nine-slice image drawn into the mask layer.
- blitz-paint render/background.rs: `background-clip: text` (vendored stylo): the background composited SrcIn
  onto the element's glyphs.
- blitz-paint render.rs: `mix-blend-mode` (a layer blend); negative z-index descendants paint before the
  element's content (CSS 2 Appendix E); blitz-dom node.rs: mix-blend-mode and layout/paint containment make
  stacking contexts.
- blitz-paint text.rs: `text-overflow: ellipsis` on boxes that clip their inline overflow.
- blitz-dom assets/default.css, layout/construct.rs, layout/mod.rs, blitz-paint form_controls.rs: checkboxes and
  radios are `appearance: auto`; an author's `appearance: none` checkbox is laid out and painted as a box with its
  ::before/::after, and restyles once its checked state is known.
- blitz-dom stylo.rs `placeholder_style`, layout/mod.rs `layout_placeholder`, blitz-paint render.rs: an empty
  input shows its `placeholder` in the `::placeholder` style.
- blitz-dom node/element.rs `style_attribute_css`: the style attribute as scripts left it (a host's debug dump).
- blitz-dom caret.rs (+ `editing_caret` in document.rs, `damage_element` in layout/paint_damage.rs), blitz-paint
  render.rs `draw_inline_layout`: an embedder's editing caret (a contenteditable's, placed by its DOM selection as a
  boundary point) drawn in the inline root that lays its text out, 1 CSS px wide in `caret-color`; boundary points and
  inline-text byte offsets mapped both ways (`caret_inline_position`, `inline_boundary_at`) where white space is
  preserved.
- blitz-dom caret.rs `edit_text_input`, `text_input_pointer` (`TextInputPointer`): a text input's editor driven by an
  embedder that dispatches its own events (its key defaults, a press, a multi-click or a drag placing the selection),
  the caret kept in view and the input repainted after each change, as blitz's own keyboard and pointer handling do.
- blitz-dom node.rs `text_input_h_align_offset`, blitz-paint render.rs `draw_text_input_text`: a single-line input's
  text (and its caret and selection) placed by its `text-align` (its editor has no width, so parley aligned the line
  to itself and a centred input's text stood at the left).
- blitz-dom stylo.rs, document.rs `set_focus_within`, `set_focus_visible`: `:focus-within` (FOCUS_WITHIN kept on
  the focused element and its ancestors) and `:focus-visible` (FOCUSRING, set by an embedder's focus-visible
  heuristic) match.
- blitz-dom caret.rs `set_caret_blink_off` (+ `caret_blink_off` in document.rs), blitz-paint render.rs: the caret's
  blink phase, from the embedder's clock; neither the editing caret nor a text input's is drawn while it is off.
- blitz-dom caret.rs `set_selection_highlight`: an embedder's DOM selection painted as the text selection highlight
  (the inline roots it leaves and covers repainted).
- blitz-dom caret.rs `caret_moved` (`CaretMove`), `caret_on_cluster_boundary`: an editing caret moved by the layout
  (a line's ends, the line above or below) and grapheme cluster boundaries as the text is shaped.
- blitz-dom caret.rs `set_input_checked`: a checkbox's or radio's checkedness set by an embedder's activation
  (`:checked` restyled, the input repainted).
- blitz-dom node/text.rs `TextInputData::secret`, `set_masked`, `value`, `masked`, `MASK_CHAR`, layout/construct.rs:
  a password input keeps its value apart and its editor shows one U+2022 per character (laid out, painted and
  hit-tested masked); `set_text` updates both.
- blitz-dom tree.rs `dirty_generation`, node.rs (`mark_ancestors_dirty`, `mark_damaged`, `set_dirty_descendants` bump
  it), document.rs `needs_resolve`, resolve.rs: a resolve on an unchanged document returns at once. Everything that
  gives a resolve work bumps the tree's dirty generation or is pending state `needs_resolve` sees (snapshots, device
  and stylesheet changes, running CSS animations with a later clock, a scroll animation, queued construction or
  images, sub-documents); the resolve records the generation it consumed after its damage pass, so marks made later
  (box construction's own, a checkbox's `:checked` restyle, `refresh_hover`) give the next resolve work. Was: every
  resolve walked and remeasured the whole tree (0.5-1.4 ms on a heavy page, 7-8 forced resolves a frame).
- blitz-dom document.rs `animation_clock`, stylo.rs `resolve_stylist(now, tick)`: CSS animations and transitions
  tick only when a resolve's clock is later than the last tick's (time never runs backwards), so an embedder's frame
  clock ticks them once a frame however many forced layouts the frame makes.
- blitz-dom layout/paint_damage.rs: paint damage measured once per paint (`take_paint_damage`), not per resolve; the
  elements damaged by their own changes are noted during `propagate_damage_flags` (a bitset by slot), the per-element
  records are vectors by slot (no SipHash maps). A filter's damage reaches as far as it spreads the pixels (`blur`
  3 sigma, `drop-shadow` 3 sigma plus its offset, colour filters nothing), for the filtered element and its whole
  subtree. Was: a filtered element's own damage made the whole window damaged (a brightness filter on a bar,
  an animated icon), and a blurred element's children damaged only their own boxes.
- blitz-dom scrolling.rs `write_scroll_offset`: a scrolled element repaints (paint damage) and re-resolves hover.
- blitz-dom document.rs `set_native_surfaces`: a canvas becoming or ceasing to be an embedder's surface repaints.
- blitz-paint render.rs: an element is culled by its boxes grown by its ink (shadows, outline, filter spread), and a
  filtered element's descendants by a clip grown by its filter's spread, so a region repaint beside them still draws
  what reaches into it.
- blitz-dom util.rs `FONT_DB`: every system font file mapped once and its faces shared (an inline SVG's `<text>` became
  outlines through a face opened and mapped on every access: 2.6 ms per parse of a small map, 0.17 ms shared);
  layout/construct.rs: an `<svg>` parsed by box construction leaves `dirty_svgs`, so a change parses it once, not
  twice.
- A/B switches (off by default, read once): BLITZ_LEGACY_RESOLVE=1 (the whole resolve every time, animations ticked
  at every resolve, paint damage measured per resolve and a filtered element's damage the whole window, as before),
  BLITZ_LEGACY_SVG=1 (unshared font faces, the double SVG parse).
- blitz-paint render.rs `create_css_rect`: border widths from Stylo's computed style, not Taffy's per-edge rounding (a
  1px border at a fractional scale came out 1 on one side and 0 on the other), with a none or hidden side zero: its
  computed width stays `medium` (3px; only the resolved value is zeroed), which inset every border-less box's padding
  box by 3px (overflow clips cut a line's first letter, 11-23 to 11-24).
