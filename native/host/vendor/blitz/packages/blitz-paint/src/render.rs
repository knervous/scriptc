mod background;
mod border;
mod border_image;
mod box_shadow;
mod clip_path;
mod form_controls;
mod mask;

use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::Arc;

use super::kurbo_css::CssBox;
use crate::color::{Color, ToColorColor};
use crate::debug_overlay::render_debug_overlay;
use crate::filters::convert_filters;
use crate::kurbo_css::NonUniformRoundedRectRadii;
use crate::layers::LayerManager;
use crate::sizing::compute_object_fit;
use crate::text::DrawTextContext;
use crate::{CustomWidgetSceneMap, SELECTION_COLOR};
use anyrender::{PaintScene, Scene};
use blitz_dom::node::{
    ListItemLayout, ListItemLayoutPosition, Marker, NodeData, RasterImageData, TextInputData,
    TextNodeData,
};
use blitz_dom::{BaseDocument, ElementData, Node, NodeId, local_name};
use blitz_traits::devtools::DevtoolSettings;

use style::values::computed::{BorderCornerRadius, ColorOrAuto};
use style::{
    dom::TElement,
    properties::{
        ComputedValues, generated::longhands::visibility::computed_value::T as StyloVisibility,
        style_structs::Font,
    },
    values::{
        computed::{CSSPixelLength, Contain, Overflow},
        specified::box_::{DisplayInside, DisplayOutside},
        specified::image::ImageRendering,
    },
};

use kurbo::{self, Affine, Insets, Point, Rect, Shape, Size, Stroke, Vec2};
use peniko::{self, Fill, ImageData, ImageSampler};
use style::values::generics::color::GenericColor;
use taffy::Layout;

/// A view of the track positions reported by taffy in physical (left-to-right /
/// top-to-bottom) order. Taffy reports tracks in logical order, which for RTL grid
/// containers is physically reversed.
#[derive(Clone, Copy)]
pub(crate) struct PhysicalTracks<'a> {
    positions: &'a [taffy::Line<f32>],
    reversed: bool,
}

impl<'a> PhysicalTracks<'a> {
    pub(crate) fn from_tracks<S: taffy::CheapCloneStr>(
        tracks: &'a taffy::DetailedGridTracksInfo<S>,
    ) -> Self {
        let positions = tracks.positions.as_slice();
        let reversed = positions
            .first()
            .zip(positions.last())
            .is_some_and(|(first, last)| first.start > last.start);
        Self {
            positions,
            reversed,
        }
    }

    fn get(self, index: usize) -> taffy::Line<f32> {
        if self.reversed {
            self.positions[self.positions.len() - 1 - index]
        } else {
            self.positions[index]
        }
    }

    /// Iterate track positions in physical order
    pub(crate) fn iter(self) -> impl ExactSizeIterator<Item = taffy::Line<f32>> + 'a {
        (0..self.positions.len()).map(move |index| self.get(index))
    }

    /// The physical start position of the first track
    pub(crate) fn origin(self) -> f32 {
        if self.positions.is_empty() {
            0.0
        } else {
            self.get(0).start
        }
    }

    /// Total distance from the start of the first track to the end of the last track
    pub(crate) fn span(self) -> f32 {
        if self.positions.is_empty() {
            0.0
        } else {
            self.get(self.positions.len() - 1).end - self.get(0).start
        }
    }
}

/// A short-lived struct which holds a bunch of parameters for rendering a scene so
/// that we don't have to pass them down as parameters
pub struct BlitzDomPainter<'dom, 'a> {
    /// Input parameters (read only) for generating the Scene
    pub(crate) dom: &'dom BaseDocument,
    pub(crate) scale: f64,
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) initial_x: f64,
    pub(crate) initial_y: f64,
    /// [fork] The document point (device px) the target's top-left shows when painting a
    /// region (paint_scene_region): culling clips to the region there. Zero otherwise.
    pub(crate) clip_origin: (f64, f64),
    /// The id of the document's root element (cached to avoid re-resolving it for every element)
    pub(crate) root_element_id: Option<NodeId>,
    /// Scrollbar hover/drag state, resolved once per scene like the root element
    #[cfg(feature = "scrollbars")]
    pub(crate) hovered_scrollbar: Option<blitz_dom::node::ScrollbarRef>,
    #[cfg(feature = "scrollbars")]
    pub(crate) scrollbar_drag_target: Option<blitz_dom::node::ScrollbarRef>,
    pub(crate) layer_manager: LayerManager,
    /// Reusable scratch allocations shared by all text layouts painted for this document.
    pub(crate) draw_text_context: RefCell<DrawTextContext>,
    /// Cached selection ranges for O(1) lookup: node_id -> (start_offset, end_offset)
    pub(crate) selection_ranges: HashMap<NodeId, (usize, usize)>,

    // Pre-computed `Scene`s for each CustomWidget
    pub(crate) custom_widget_scenes: &'a CustomWidgetSceneMap,
}

impl<'dom, 'a> BlitzDomPainter<'dom, 'a> {
    /// Create a new BlitzDomPainter for the given document
    pub fn new(
        dom: &'dom BaseDocument,
        scale: f64,
        width: u32,
        height: u32,
        initial_x: f64,
        initial_y: f64,
        custom_widget_scenes: &'a CustomWidgetSceneMap,
    ) -> Self {
        let selection_ranges: HashMap<NodeId, (usize, usize)> = dom
            .get_text_selection_ranges()
            .into_iter()
            .map(|(node_id, start, end)| (node_id, (start, end)))
            .collect();

        let layer_manager = LayerManager::default();
        let root_element_id = dom.try_root_element().map(|el| el.id);

        Self {
            dom,
            scale,
            width,
            height,
            initial_x,
            initial_y,
            clip_origin: (0.0, 0.0),
            root_element_id,
            #[cfg(feature = "scrollbars")]
            hovered_scrollbar: dom.hovered_scrollbar(),
            #[cfg(feature = "scrollbars")]
            scrollbar_drag_target: dom.scrollbar_drag_target(),
            layer_manager,
            draw_text_context: RefCell::new(DrawTextContext::default()),
            selection_ranges,
            custom_widget_scenes,
        }
    }

    /// Draw the current tree to current render surface
    /// Eventually we'll want the surface itself to be passed into the render function, along with things like the viewport
    ///
    /// This assumes styles are resolved and layout is complete.
    /// Make sure you do those before trying to render
    pub fn paint_scene(&self, scene: &mut impl PaintScene) {
        if self.dom.has_pending_critical_resources() {
            return;
        }

        // Simply render the document (the root element (note that this is not the same as the root node)))
        // scene.reset();
        let viewport_scroll = self.dom.as_ref().viewport_scroll();

        // A document without a root element (e.g. an empty iframe sub-document) has
        // nothing to paint.
        let Some(root_element) = self.dom.as_ref().try_root_element() else {
            return;
        };
        let root_id = root_element.id;
        let bg_width = (self.width as f32).max(root_element.final_layout().size.width);
        let bg_height = (self.height as f32).max(root_element.final_layout().size.height);

        let background_color = {
            let html_color = root_element
                .primary_styles()
                .map(|s| s.clone_background_color())
                .unwrap_or(GenericColor::TRANSPARENT_BLACK);
            if html_color == GenericColor::TRANSPARENT_BLACK {
                root_element
                    .children
                    .iter()
                    .find_map(|id| {
                        self.dom
                            .as_ref()
                            .get_node(*id)
                            .filter(|node| node.data.is_element_with_tag_name(&local_name!("body")))
                    })
                    .and_then(|body| body.primary_styles())
                    .map(|style| {
                        let current_color = style.clone_color();
                        style
                            .clone_background_color()
                            .resolve_to_absolute(&current_color)
                    })
            } else {
                let current_color = root_element.primary_styles().unwrap().clone_color();
                Some(html_color.resolve_to_absolute(&current_color))
            }
        };

        if let Some(bg_color) = background_color {
            let bg_color = bg_color.as_srgb_color();
            let rect = Rect::from_origin_size(
                (self.initial_x, self.initial_y),
                (bg_width as f64, bg_height as f64),
            );
            scene.fill(Fill::NonZero, Affine::IDENTITY, bg_color, None, &rect);
        }

        // The root clip rectangle is the viewport (in screen coordinates, with the
        // initial offset already subtracted). Elements outside of this are culled, and
        // scrollports narrow this rectangle further for their descendants.
        let (cx, cy) = self.clip_origin;
        let viewport_clip_rect = Rect::new(cx, cy, cx + self.width as f64, cy + self.height as f64);

        self.render_element(
            scene,
            root_id,
            Affine::translate(Vec2 {
                x: self.initial_x - (viewport_scroll.x * self.scale),
                y: self.initial_y - (viewport_scroll.y * self.scale),
            }),
            viewport_clip_rect,
        );

        // Render debug overlay
        if self.dom.devtools().highlight_hover {
            if let Some(node_id) = self.dom.as_ref().get_hover_node_id() {
                render_debug_overlay(
                    scene,
                    self.dom,
                    node_id,
                    self.scale,
                    self.initial_x,
                    self.initial_y,
                );
            }
        }
        if let Some(node_id) = self.dom.devtools().highlight_node {
            // Only nodes with element data have a layout to visualise
            if self
                .dom
                .as_ref()
                .get_node(node_id)
                .is_some_and(|node| node.element_data().is_some())
            {
                render_debug_overlay(
                    scene,
                    self.dom,
                    node_id,
                    self.scale,
                    self.initial_x,
                    self.initial_y,
                );
            }
        }
    }

    /// Renders a node, but is guaranteed that the node is an element
    /// This is because the font_size is calculated from layout resolution and all text is rendered directly here, instead
    /// of a separate text stroking phase.
    ///
    /// In Blitz, text styling gets its attributes from its container element/resolved styles
    /// In other libraries, text gets its attributes from a `text` element - this is not how HTML works.
    ///
    /// Approaching rendering this way guarantees we have all the styles we need when rendering text with not having
    /// to traverse back to the parent for its styles, or needing to pass down styles
    fn render_element(
        &self,
        scene: &mut impl PaintScene,
        node_id: NodeId,
        parent_style_transform: Affine,
        clip_rect: Rect,
    ) {
        let node = &self.dom.as_ref().tree()[node_id];

        // Early return if the element is hidden
        if matches!(node.taffy_display(), taffy::Display::None) {
            return;
        }

        // Only draw elements with a style
        let Some(styles) = node.primary_styles() else {
            return;
        };

        // Hide inputs with type=hidden
        // Implemented here rather than using the style engine for performance reasons
        if node.local_name() == "input" && node.attr(local_name!("type")) == Some("hidden") {
            return;
        }

        // Hide elements with a visibility style other than visible
        if styles.get_inherited_box().visibility != StyloVisibility::Visible {
            return;
        }

        let effects = styles.get_effects();
        let opacity = effects.opacity;
        if opacity == 0.0 {
            return;
        }
        let has_opacity = opacity < 1.0;

        // TODO: account for overflow_x vs overflow_y
        let overflow_x = styles.get_box().overflow_x;
        let overflow_y = styles.get_box().overflow_y;
        // `contain: paint` (and stronger values like `strict`/`content`) clips the element's
        // contents to its padding box. Paint containment does not apply to non-atomic inlines
        // or internal table boxes other than table-cell.
        let contain_paint = styles.get_box().clone_contain().contains(Contain::PAINT) && {
            let display = styles.clone_display();
            let is_internal_table_box_other_than_cell = display.outside()
                == DisplayOutside::InternalTable
                && display.inside() != DisplayInside::TableCell;
            !display.is_inline_flow() && !is_internal_table_box_other_than_cell
        };
        let is_image = node
            .element_data()
            .and_then(|e| e.raster_image_data())
            .is_some();
        let is_sub_doc = node
            .element_data()
            .and_then(|el| el.sub_doc_data())
            .is_some();
        let is_text_input = node
            .element_data()
            .and_then(|el| el.text_input_data())
            .is_some();
        // The root element's overflow is propagated to the viewport (which is clipped by the
        // window/surface bounds), so the root element must not clip its own overflow.
        let is_root_element = self.root_element_id == Some(node_id);
        let should_clip = !is_root_element
            && (is_image
                || is_sub_doc
                || is_text_input
                || contain_paint
                || !matches!(overflow_x, Overflow::Visible)
                || !matches!(overflow_y, Overflow::Visible));

        // Apply padding/border offset to inline root
        let taffy::Layout {
            size,
            border,
            padding,
            location,
            ..
        } = *node.final_layout();
        let box_position = Vec2::new(location.x as f64, location.y as f64) * self.scale;
        let box_size = Size::new(size.width as f64, size.height as f64);
        let border_box = Rect::from_origin_size(box_position.to_point(), box_size);
        let scaled_pb = (padding + border).map(f64::from);
        let content_position = kurbo::Point {
            x: scaled_pb.left,
            y: scaled_pb.top,
        };
        let content_box_size = kurbo::Size {
            width: (size.width as f64 - scaled_pb.left - scaled_pb.right) * self.scale,
            height: (size.height as f64 - scaled_pb.top - scaled_pb.bottom) * self.scale,
        };

        // Don't render things that are out of view
        let overflow = *node.scrollable_overflow();
        let transform = parent_style_transform
            * Affine::translate(box_position)
            * node.transform().as_deref().copied().unwrap_or_default();

        let screen_transform = Affine::translate(Vec2 {
            x: -self.initial_x,
            y: -self.initial_y,
        }) * transform;
        // [fork] Grown by what the element paints outside its boxes (shadows, outline, its filter's spread): a
        // region repaint (paint_scene_region) beside an element must still draw the part of its shadow or blur that
        // reaches into the region. Was: culled by its boxes alone, so the region showed a shadow cut away.
        let filter_reach = blitz_dom::filter_reach(node) * self.scale;
        let ink = blitz_dom::ink_outset(node) * self.scale + filter_reach;
        let screen_bbox = screen_transform.transform_rect_bbox(overflow.union(border_box).inflate(ink, ink));

        // Cull elements that fall entirely outside the current clip rectangle. In addition to
        // the viewport, `clip_rect` is narrowed by any ancestor scrollport (see below), so this
        // also culls elements scrolled out of view inside a clipping/scrolling container.
        if screen_bbox.x1 < clip_rect.x0
            || screen_bbox.x0 > clip_rect.x1
            || screen_bbox.y1 < clip_rect.y0
            || screen_bbox.y0 > clip_rect.y1
        {
            return;
        }

        // Cull elements whose transformed geometry is not representable in f32 (e.g.
        // `transform: scale(99e99)`): the renderer works in f32 and flattening such paths
        // can attempt to allocate an unbounded number of line segments.
        let f32_max = f64::from(f32::MAX);
        if !screen_bbox.is_finite()
            || [
                screen_bbox.x0,
                screen_bbox.y0,
                screen_bbox.x1,
                screen_bbox.y1,
            ]
            .iter()
            .any(|c| c.abs() > f32_max)
        {
            return;
        }

        // Optimise zero-area (/very small area) clips by not rendering at all
        let clip_area = content_box_size.width * content_box_size.height;
        let overflow_area =
            node.scrollable_overflow().width() * node.scrollable_overflow().height();
        if should_clip && clip_area < 0.01 && overflow_area < 0.01 {
            return;
        }

        #[cfg(feature = "custom-widget")]
        let custom_widget_scene = self.custom_widget_scenes.get(&(self.dom.id(), node_id));
        #[cfg(not(feature = "custom-widget"))]
        let custom_widget_scene = None;

        // Apply CSS transform property (where transforms are 2d)

        let mut cx = self.element_cx(node, *node.final_layout(), transform, custom_widget_scene);

        // If this element clips its overflow it establishes a scrollport: narrow the clip
        // rectangle passed to descendants to the visible (clipped) region so that content
        // scrolled out of view is culled rather than drawn and clipped away. The box used
        // here matches the clip applied to the content below.
        // [fork] A filter spreads its subtree's pixels: descendants that far outside the clip still draw into it.
        let clip_rect = if filter_reach > 0.0 { clip_rect.inflate(filter_reach, filter_reach) } else { clip_rect };
        let child_clip_rect = if should_clip {
            let clip_box = if is_text_input {
                cx.frame.content_box_path()
            } else {
                cx.frame.padding_box_path()
            };
            clip_rect.intersect(screen_transform.transform_rect_bbox(clip_box.bounding_box()))
        } else {
            clip_rect
        };

        // Compute clip-path (if any) and wrap all rendering in a clip layer
        let clip_path_shape = cx.clip_path_shape();
        let has_clip_path = clip_path_shape.is_some();
        let default_clip = cx.frame.border_box_path();
        let mut clip_path_for_layer = clip_path_shape.unwrap_or(default_clip);
        clip_path_for_layer.apply_affine(Affine::scale(self.scale));

        // CSS 2 `clip` property (absolutely positioned elements only). Applies to the whole of
        // the element's rendering (including outlines and shadows), so it is the outermost layer.
        let css_clip_rect = cx.css_clip_rect();
        if css_clip_rect.is_some_and(|rect| rect.is_zero_area()) {
            return;
        }
        let css_clip_layer_pushed = self.layer_manager.maybe_push_layer(
            scene,
            css_clip_rect.is_some(),
            1.0,
            cx.transform,
            &css_clip_rect.unwrap_or(Rect::ZERO),
            None,
            None,
        );

        cx.draw_outline(scene);
        cx.draw_outset_box_shadow(scene);

        // clip-path clip ayer
        self.layer_manager.maybe_with_layer(
            scene,
            has_clip_path,
            1.0,
            cx.transform,
            &clip_path_for_layer,
            None,
            None,
            |scene| {
                // If the element has a CSS `mask`, then push an isolation layer for the
                // masked content. The mask is applied when the layer is popped below.
                let mask_layer_pushed = cx.maybe_push_css_mask_layer(scene);
                // `cx.transform` is mutated to apply scroll offsets while drawing content.
                // Save it so that the mask can be drawn untransformed by scroll offsets.
                let unscrolled_transform = cx.transform;

                let filter = convert_filters(&effects.filter.0, self.scale).map(Arc::new);
                let backdrop_filter = convert_filters(&effects.backdrop_filter.0, self.scale).map(Arc::new);

                // Adjust effect layer clip by filter expansion area
                //
                // Returns a rectangle centered at the origin representing how much the filter
                // expands the processing region in each direction. The rect coordinates are:
                // - x0: negative left expansion
                // - y0: negative top expansion
                // - x1: positive right expansion
                // - y1: positive bottom expansion
                let filter_expansion_area = filter
                    .as_ref()
                    .map(|f| f.expansion_rect())
                    .unwrap_or(Rect::ZERO);

                let mut effect_layer_clip = cx.frame.border_box_path().bounding_box();
                effect_layer_clip.x0 += filter_expansion_area.x0;
                effect_layer_clip.y0 += filter_expansion_area.y0;
                effect_layer_clip.x1 += filter_expansion_area.x1;
                effect_layer_clip.y1 += filter_expansion_area.y1;

                // Opacity/Filter layer if box has opacity or a filter.
                // Clipped to border-box as it needs to include the background and borders.
                // [fork] It also carries the element's `mix-blend-mode`. The layer is clipped
                // to the border box as before, so a blended element's overflowing descendants
                // are clipped with it (they are rarely blended).
                let mix = to_peniko_mix(effects.mix_blend_mode);
                let effect_layer_pushed = self.layer_manager.maybe_push_layer_mix(
                    scene,
                    has_opacity || filter.is_some() || backdrop_filter.is_some() || mix != peniko::Mix::Normal,
                    mix,
                    opacity,
                    cx.transform,
                    &effect_layer_clip,
                    filter,
                    backdrop_filter,
                );
                {
                    let scene = &mut *scene;
                        cx.draw_background(scene);
                        cx.draw_inset_box_shadow(scene);
                        cx.draw_table_row_backgrounds(scene);
                        cx.draw_table_borders(scene);
                        // [fork] A ready border-image is drawn in place of the border styles.
                        if !cx.draw_border_image(scene) {
                            cx.draw_border(scene);
                        }
                        cx.stroke_devtools(scene);

                        // TODO: allow layers with opacity to be unclipped (overflow: visible)
                        let clip = if is_text_input {
                            &cx.frame.content_box_path()
                        } else {
                            &cx.frame.padding_box_path()
                        };

                        // Clip layer if box requires clipping. Opacity set to 1.0
                        self.layer_manager.maybe_with_layer(
                            scene,
                            should_clip,
                            1.0, // opacity
                            cx.transform,
                            clip,
                            None,
                            None,
                            |scene| {
                                // Now that background has been drawn, offset pos and cx in order to draw our contents scrolled
                                let content_position = Point {
                                    x: content_position.x - node.scroll_offset().x,
                                    y: content_position.y - node.scroll_offset().y,
                                };

                                cx.transform = cx.transform.then_translate(Vec2 {
                                    x: -node.scroll_offset().x * self.scale,
                                    y: -node.scroll_offset().y * self.scale,
                                });
                                cx.draw_native_surface(scene);
                                // [fork] Negative z-index descendants paint below the element's
                                // own content (CSS 2 Appendix E: step 3, before in-flow content and
                                // inline text): a button's z-index:-1 ::before plate went over its label.
                                cx.draw_negative_z_children(scene, cx.transform, child_clip_rect);
                                cx.draw_image(scene);
                                #[cfg(feature = "svg")]
                                cx.draw_svg(scene);
                                #[cfg(feature = "custom-widget")]
                                cx.draw_custom_widget(scene);
                                cx.draw_sub_document(scene);
                                cx.draw_input(scene);
                                cx.draw_text_input_text(scene, content_position);
                                cx.draw_inline_layout(scene, content_position);
                                cx.draw_marker(scene, content_position);
                                cx.draw_children(scene, cx.transform, child_clip_rect);
                            },
                        );

                        // Overlay scrollbars, drawn unscrolled above the
                        // clipped content.
                        #[cfg(feature = "scrollbars")]
                        {
                            cx.transform = unscrolled_transform;
                            cx.draw_scrollbars(scene);
                        }
                }
                self.layer_manager.maybe_pop_layer(scene, effect_layer_pushed);

                // Apply the CSS `mask` (if any) to the content drawn above
                cx.transform = unscrolled_transform;
                cx.maybe_pop_css_mask_layer(scene, mask_layer_pushed);
            },
        );

        self.layer_manager
            .maybe_pop_layer(scene, css_clip_layer_pushed);
    }

    fn render_node(
        &self,
        scene: &mut impl PaintScene,
        node_id: NodeId,
        parent_style_transform: Affine,
        clip_rect: Rect,
    ) {
        let node = &self.dom.as_ref().tree()[node_id];

        match &node.data {
            NodeData::Element(_) | NodeData::AnonymousBlock(_) => {
                self.render_element(scene, node_id, parent_style_transform, clip_rect)
            }
            NodeData::Text(TextNodeData { .. }) => {
                // Text nodes should never be rendered directly
                // (they should always be rendered as part of an inline layout)
                // unreachable!()
            }
            NodeData::Document(_) => {}
            // NodeData::Doctype => {}
            NodeData::Comment { .. } => {} // NodeData::ProcessingInstruction { .. } => {}
        }
    }

    fn element_cx(
        &'dom self,
        node: &'dom Node,
        layout: Layout,
        transform: Affine,
        custom_widget_scene: Option<&'a Scene>,
    ) -> ElementCx<'dom, 'a> {
        let style = node
            .stylo_element_data()
            .primary_styles()
            .as_ref()
            .map(|styles| (*styles).clone())
            .unwrap_or_else(|| {
                ComputedValues::initial_values_with_font_override(Font::initial_values()).to_arc()
            });

        let scale = self.scale;

        // todo: maybe cache this so we don't need to constantly be figuring it out
        // It is quite a bit of math to calculate during render/traverse
        // Also! we can cache the bezpaths themselves, saving us a bunch of work
        let frame = create_css_rect(&style, &layout, scale);

        let element = node.element_data().unwrap();

        ElementCx {
            context: self,
            frame,
            scale,
            style,
            node,
            element,
            transform,
            #[cfg(feature = "svg")]
            svg: match element.image_data() {
                Some(blitz_dom::node::ImageData::Svg(svg)) => Some(svg),
                _ => None,
            },
            text_input: element.text_input_data(),
            list_item: element.list_item_data.as_deref(),
            devtools: self.dom.devtools(),
            custom_widget_scene,
        }
    }
}

/// [fork] The left and top of an element's content box in its border box (CSS px).
fn content_position_x(cx: &ElementCx) -> f64 {
    let l = cx.node.final_layout();
    (l.padding.left + l.border.left) as f64
}

fn content_position_y(cx: &ElementCx) -> f64 {
    let l = cx.node.final_layout();
    (l.padding.top + l.border.top) as f64
}

/// [fork] `mix-blend-mode` as Vello's blend.
fn to_peniko_mix(mode: style::computed_values::mix_blend_mode::T) -> peniko::Mix {
    use peniko::Mix;
    use style::computed_values::mix_blend_mode::T as M;
    match mode {
        M::Normal => Mix::Normal,
        M::Multiply => Mix::Multiply,
        M::Screen => Mix::Screen,
        M::Overlay => Mix::Overlay,
        M::Darken => Mix::Darken,
        M::Lighten => Mix::Lighten,
        M::ColorDodge => Mix::ColorDodge,
        M::ColorBurn => Mix::ColorBurn,
        M::HardLight => Mix::HardLight,
        M::SoftLight => Mix::SoftLight,
        M::Difference => Mix::Difference,
        M::Exclusion => Mix::Exclusion,
        M::Hue => Mix::Hue,
        M::Saturation => Mix::Saturation,
        M::Color => Mix::Color,
        M::Luminosity => Mix::Luminosity,
        // No plus-lighter mix in Vello's set: drawn normally.
        M::PlusLighter => Mix::Normal,
    }
}

fn to_image_quality(image_rendering: ImageRendering) -> peniko::ImageQuality {
    match image_rendering {
        ImageRendering::Auto => peniko::ImageQuality::Medium,
        ImageRendering::CrispEdges => peniko::ImageQuality::Low,
        ImageRendering::Pixelated => peniko::ImageQuality::Low,
    }
}

/// The transform from an SVG's rendered tree to a viewport of the given size.
#[cfg(feature = "svg")]
fn svg_viewport_affine(svg: &blitz_dom::node::SvgImageData, width: f32, height: f32) -> Affine {
    let t = svg.viewport_transform(width, height);
    Affine::new([t.sx, t.ky, t.kx, t.sy, t.tx, t.ty].map(f64::from))
}

/// Ensure that the `resized_image` field has a correctly sized image
fn to_peniko_image(image: &RasterImageData, quality: peniko::ImageQuality) -> peniko::ImageBrush {
    peniko::ImageBrush {
        image: ImageData {
            data: image.data.clone(),
            format: peniko::ImageFormat::Rgba8,
            width: image.width,
            height: image.height,
            alpha_type: peniko::ImageAlphaType::Alpha,
        },
        sampler: ImageSampler {
            x_extend: peniko::Extend::Repeat,
            y_extend: peniko::Extend::Repeat,
            quality,
            alpha: 1.0,
        },
    }
}

/// A context of loaded and hot data to draw the element from
struct ElementCx<'dom, 'a> {
    context: &'dom BlitzDomPainter<'dom, 'a>,
    frame: CssBox,
    style: style::servo_arc::Arc<ComputedValues>,
    scale: f64,
    node: &'dom Node,
    element: &'dom ElementData,
    transform: Affine,
    #[cfg(feature = "svg")]
    svg: Option<&'dom blitz_dom::node::SvgImageData>,
    text_input: Option<&'dom TextInputData>,
    list_item: Option<&'dom ListItemLayout>,
    devtools: &'dom DevtoolSettings,
    #[cfg_attr(not(feature = "custom-widget"), expect(unused))]
    custom_widget_scene: Option<&'a Scene>,
}

/// Converts parley BoundingBox into peniko Rect
fn convert_rect(rect: &parley::BoundingBox) -> kurbo::Rect {
    peniko::kurbo::Rect::new(rect.x0, rect.y0, rect.x1, rect.y1)
}

impl ElementCx<'_, '_> {
    /// Paint overlay scrollbar thumbs for scroll containers: `overflow:
    /// scroll`, or `auto` when the content overflows (never `hidden`/`clip`,
    /// which scroll only programmatically). Thumbs appear on scroll and fade
    /// out after a delay ([`BaseDocument::scrollbar_opacity`]); never-scrolled
    /// containers paint nothing, keeping thumbs out of static reftest
    /// screenshots.
    ///
    /// Geometry comes from [`Node::scrollbar_thumb`], shared with the
    /// thumb-drag hit testing in blitz-dom.
    #[cfg(feature = "scrollbars")]
    fn draw_scrollbars(&self, scene: &mut impl PaintScene) {
        // css-scrollbars-1 scrollbar-color: author thumb/track colors
        use blitz_dom::node::{ScrollbarColor, ScrollbarRef};
        use taffy::AbsoluteAxis;
        let (custom_thumb, custom_track) = match self.node.scrollbar_color() {
            ScrollbarColor::Auto => (None, None),
            ScrollbarColor::Colors { thumb, track } => {
                (Some(thumb.as_srgb_color()), Some(track.as_srgb_color()))
            }
        };

        let drag_target = self.context.scrollbar_drag_target;
        let hovered_thumb = self.context.hovered_scrollbar;

        // scrollbar-color doesn't affect overlay visibility: persistence is
        // UA policy, not author styling.
        let node_id = self.node.id;
        let opacity = self.context.dom.scrollbar_opacity(node_id);
        if opacity == 0.0 {
            return;
        }

        // Default thumb palette for the used color scheme; thumbs paint as
        // fill plus a thin contrast stroke so they read over same-colored
        // content.
        let dark_scheme =
            self.context.dom.viewport().color_scheme == blitz_traits::shell::ColorScheme::Dark;
        let (thumb_rest, thumb_hover, thumb_active, stroke_color) = if dark_scheme {
            (
                Color::from_rgba8(214, 214, 214, 178),
                Color::from_rgba8(190, 190, 190, 222),
                Color::from_rgba8(172, 172, 172, 255),
                Color::from_rgba8(0, 0, 0, 102),
            )
        } else {
            (
                Color::from_rgba8(128, 128, 128, 178),
                Color::from_rgba8(152, 152, 152, 222),
                Color::from_rgba8(170, 170, 170, 255),
                Color::from_rgba8(255, 255, 255, 102),
            )
        };

        // Chromium's hovered/pressed scrollbar contrast ratios.
        const HOVER_CONTRAST: f32 = 1.8;
        const ACTIVE_CONTRAST: f32 = 1.3;

        for axis in [AbsoluteAxis::Vertical, AbsoluteAxis::Horizontal] {
            if !self.node.wants_scrollbar(axis) {
                continue;
            }
            let Some(thumb) = self.node.scrollbar_thumb(axis) else {
                continue;
            };

            let rect = thumb.scale_from_origin(self.scale);

            // Track (only when the author specified a track color)
            if let Some(track_color) = custom_track {
                let padding_box = self.frame.padding_box;
                let track_rect = match axis {
                    AbsoluteAxis::Horizontal => {
                        Rect::new(padding_box.x0, rect.y0, padding_box.x1, rect.y1)
                    }
                    AbsoluteAxis::Vertical => {
                        Rect::new(rect.x0, padding_box.y0, rect.x1, padding_box.y1)
                    }
                };
                scene.fill(
                    Fill::NonZero,
                    self.transform,
                    track_color.multiply_alpha(opacity),
                    None,
                    &track_rect,
                );
            }

            let this = ScrollbarRef { node_id, axis };
            let is_active = drag_target == Some(this);
            let is_hovered = hovered_thumb == Some(this);
            let color = match custom_thumb {
                Some(base) if is_active => crate::color::blend_for_contrast(base, ACTIVE_CONTRAST),
                Some(base) if is_hovered => crate::color::blend_for_contrast(base, HOVER_CONTRAST),
                Some(base) => base,
                None if is_active => thumb_active,
                None if is_hovered => thumb_hover,
                None => thumb_rest,
            };
            let radius = match axis {
                AbsoluteAxis::Horizontal => rect.height() / 2.0,
                AbsoluteAxis::Vertical => rect.width() / 2.0,
            };
            scene.fill(
                Fill::NonZero,
                self.transform,
                color.multiply_alpha(opacity),
                None,
                &rect.to_rounded_rect(radius),
            );
            // Contrast stroke, default thumbs only: an author-specified
            // scrollbar-color is rendered exactly as given.
            if custom_thumb.is_none() {
                let stroke_width = self.scale;
                let stroke_rect = rect.inset(-stroke_width / 2.0);
                scene.stroke(
                    &Stroke::new(stroke_width),
                    self.transform,
                    stroke_color.multiply_alpha(opacity),
                    None,
                    &stroke_rect.to_rounded_rect(radius - stroke_width / 2.0),
                );
            }
        }
    }

    fn draw_inline_layout(&self, scene: &mut impl PaintScene, pos: Point) {
        // [fork] An empty editing host holding the caret whose only content is generated (a placeholder
        // `::before`, which then forms its own box, so the host is no inline root): the caret at the content box's
        // start, the box's height (one line).
        if !self.node.flags.is_inline_root()
            && self.node.children.is_empty()
            && self.context.dom.editing_caret().is_some_and(|c| c.node == self.node.id)
            && !self.context.dom.caret_blink_off()
        {
            let color = self.style.get_inherited_text().color;
            let caret_color = match &self.style.get_inherited_ui().caret_color.0 {
                ColorOrAuto::Auto => color,
                ColorOrAuto::Color(c) => c.resolve_to_absolute(&color),
            };
            // The frame is in device px already.
            let h = self.frame.content_box.height();
            let rect = kurbo::Rect::new(pos.x * self.scale, pos.y * self.scale, (pos.x + 1.0) * self.scale, pos.y * self.scale + h);
            scene.fill(Fill::NonZero, self.transform, caret_color.as_srgb_color(), None, &rect);
        }
        if self.node.flags.is_inline_root() {
            let text_layout = self.element
                .inline_layout_data
                .as_ref()
                .unwrap_or_else(|| {
                    panic!("Tried to render node marked as inline root that does not have an inline layout: {:?}", self.node);
                });

            let pos = Point {
                x: pos.x,
                y: pos.y + text_layout.block_offset as f64,
            };
            let transform =
                self.transform * Affine::translate((pos.x * self.scale, pos.y * self.scale));

            // Render inline element backgrounds (e.g. `<span style="background: ...">`)
            // behind the text and selection highlight.
            crate::text::draw_inline_backgrounds(
                scene,
                text_layout.layout.lines(),
                self.context.dom,
                transform,
                self.node.id,
            );

            // Render text selection highlight (if any) using cached selection ranges
            if let Some(&(sel_start, sel_end)) = self.context.selection_ranges.get(&self.node.id) {
                crate::text::draw_text_selection(
                    scene,
                    &text_layout.layout,
                    transform,
                    sel_start,
                    sel_end,
                );
            }

            // Render text
            let mut draw_text_context = self.context.draw_text_context.borrow_mut();
            // [fork] `text-overflow: ellipsis` on a box that clips its inline overflow: lines past
            // the content box's end are cut before an ellipsis.
            let ellipsis_at = {
                use style::values::specified::text::TextOverflowSide;
                let clips = !matches!(self.style.get_box().overflow_x, Overflow::Visible);
                let ellipsis = matches!(self.style.get_text().text_overflow.second, TextOverflowSide::Ellipsis);
                (clips && ellipsis).then(|| self.frame.content_box.width())
            };
            crate::text::stroke_text(
                scene,
                text_layout.layout.lines(),
                self.context.dom,
                transform,
                self.scale,
                self.node.id,
                &mut draw_text_context,
                ellipsis_at,
            );
            drop(draw_text_context);

            // [fork] The editing caret (blitz-dom caret.rs) when it is in this inline root: a 1 CSS px bar the
            // line's height, in `caret-color` (else the text colour).
            // [fork] Not in the blink's off phase (caret.rs `set_caret_blink_off`).
            if let Some(caret) = self.context.dom.editing_caret().filter(|_| !self.context.dom.caret_blink_off())
                && let Some((root, byte)) = self.context.dom.caret_inline_position(caret)
                && root == self.node.id
            {
                let cursor = parley::Cursor::from_byte_index(&text_layout.layout, byte, parley::Affinity::Downstream);
                let rect = cursor.geometry(&text_layout.layout, self.scale as f32);
                let color = self.style.get_inherited_text().color;
                let caret_color = match &self.style.get_inherited_ui().caret_color.0 {
                    ColorOrAuto::Auto => color,
                    ColorOrAuto::Color(c) => c.resolve_to_absolute(&color),
                };
                scene.fill(Fill::NonZero, transform, caret_color.as_srgb_color(), None, &convert_rect(&rect));
            }
        }
    }

    fn draw_text_input_text(&self, scene: &mut impl PaintScene, pos: Point) {
        // Render the text in text inputs
        if let Some(input_data) = self.text_input {
            // For single-line inputs, add an offset to vertically center the text input layout
            // within the content box of it's node.
            let y_offset = self.node.text_input_v_centering_offset(self.scale);
            // [fork] A single line placed by its `text-align` (node.rs `text_input_h_align_offset`).
            let pos = Point {
                x: pos.x + self.node.text_input_h_align_offset(),
                y: pos.y + y_offset,
            };

            // Apply the scroll offset (stored in CSS pixels, scaled here to device pixels) so
            // that the caret stays visible. Single-line inputs scroll horizontally; multi-line
            // inputs scroll vertically.
            let scroll_offset = input_data.scroll_offset as f64 * self.scale;
            let (scroll_x, scroll_y) = if input_data.is_multiline {
                (0.0, scroll_offset)
            } else {
                (scroll_offset, 0.0)
            };

            let transform = self.transform
                * Affine::translate((pos.x * self.scale - scroll_x, pos.y * self.scale - scroll_y));

            if self.node.is_focussed() {
                // Render selection/caret
                for (rect, _line_idx) in input_data.editor.selection_geometry().iter() {
                    scene.fill(
                        Fill::NonZero,
                        transform,
                        SELECTION_COLOR,
                        None,
                        &convert_rect(rect),
                    );
                }
                // [fork] Not in the blink's off phase (caret.rs `set_caret_blink_off`).
                if let Some(cursor) = input_data.editor.cursor_geometry(1.5).filter(|_| !self.context.dom.caret_blink_off()) {
                    let color = self.style.get_inherited_text().color;
                    let caret_color = match &self.style.get_inherited_ui().caret_color.0 {
                        ColorOrAuto::Auto => color,
                        ColorOrAuto::Color(caret_color) => caret_color.resolve_to_absolute(&color),
                    };

                    scene.fill(
                        Fill::NonZero,
                        transform,
                        caret_color.as_srgb_color(),
                        None,
                        &convert_rect(&cursor),
                    );
                };
            }

            // [fork] An empty input shows its placeholder, in the `::placeholder` style, vertically
            // centred in a single-line input's content box.
            if input_data.editor.raw_text().is_empty()
                && let Some((placeholder, color)) = &input_data.placeholder
            {
                let content_h = self.frame.content_box.height();
                let y = if input_data.is_multiline {
                    0.0
                } else {
                    ((content_h - placeholder.height() as f64) / 2.0).max(0.0)
                };
                // Aligned by the input's `text-align` (the placeholder is laid out unbroken).
                let free = (self.frame.content_box.width() - placeholder.width() as f64).max(0.0);
                let x = {
                    use style::values::specified::text::TextAlignKeyword as T;
                    match self.style.clone_text_align() {
                        T::Center | T::MozCenter => free / 2.0,
                        T::Right | T::MozRight | T::End => free,
                        _ => 0.0,
                    }
                };
                let at = self.transform
                    * Affine::translate((
                        content_position_x(self) * self.scale + x,
                        content_position_y(self) * self.scale + y,
                    ));
                crate::text::fill_glyph_shapes(scene, placeholder.lines(), at, *color);
            }

            // Render text
            let mut draw_text_context = self.context.draw_text_context.borrow_mut();
            crate::text::stroke_text(
                scene,
                input_data.editor.try_layout().unwrap().lines(),
                self.context.dom,
                transform,
                self.scale,
                self.node.id,
                &mut draw_text_context,
                None,
            );
        }
    }

    fn draw_marker(&self, scene: &mut impl PaintScene, pos: Point) {
        if let Some(ListItemLayout {
            marker,
            position: ListItemLayoutPosition::Outside(layout),
        }) = self.list_item
        {
            // Right align and pad the bullet when rendering outside
            let x_padding = match marker {
                Marker::Char(_) => 8.0,
                Marker::String(_) => 0.0,
            };
            // Outside markers are placed outside the list item's border box
            // (`pos` is the origin of its content box)
            let item_layout = self.node.final_layout();
            let x_offset = -(layout.full_width() / layout.scale()
                + x_padding
                + item_layout.padding.left
                + item_layout.border.left);

            // Align the marker with the baseline of the first line of text in the list item
            let y_offset = if let Some((text_layout, first_text_line)) = &self
                .element
                .inline_layout_data
                .as_ref()
                .and_then(|text_layout| Some((text_layout, text_layout.layout.lines().next()?)))
            {
                (first_text_line.metrics().baseline
                    - layout.lines().next().unwrap().metrics().baseline)
                    / layout.scale()
                    + text_layout.block_offset
            } else {
                0.0
            };

            let pos = Point {
                x: pos.x + x_offset as f64,
                y: pos.y + y_offset as f64,
            };

            let transform =
                self.transform * Affine::translate((pos.x * self.scale, pos.y * self.scale));

            let mut draw_text_context = self.context.draw_text_context.borrow_mut();
            crate::text::stroke_text(
                scene,
                layout.lines(),
                self.context.dom,
                transform,
                self.scale,
                self.node.id,
                &mut draw_text_context,
                None,
            );
        }
    }

    /// Negative z_index hoisted nodes (painted before the element's content).
    fn draw_negative_z_children(
        &self,
        scene: &mut impl PaintScene,
        parent_style_transform: Affine,
        clip_rect: Rect,
    ) {
        if let Some(hoisted) = &self.node.stacking_context {
            for hoisted_child in hoisted.neg_z_hoisted_children() {
                let position = hoisted_child.position(self.node.tree(), self.node.id);
                let pos = kurbo::Vec2 {
                    x: position.x as f64 * self.scale,
                    y: position.y as f64 * self.scale,
                };
                self.render_node(
                    scene,
                    hoisted_child.node_id,
                    parent_style_transform.pre_translate(pos),
                    clip_rect,
                );
            }
        }
    }

    /// The element's in-flow children and its non-negative z_index hoisted nodes (the negative ones
    /// paint earlier: [`Self::draw_negative_z_children`]).
    fn draw_children(
        &self,
        scene: &mut impl PaintScene,
        parent_style_transform: Affine,
        clip_rect: Rect,
    ) {
        // Regular children
        if let Some(children) = &*self.node.paint_children.borrow() {
            for child_id in children {
                // Fixed-position children of the root element are positioned against
                // the viewport and do not scroll with it, so cancel out the viewport
                // scroll (applied in `paint_scene`). A fixed box contained by a
                // transformed ancestor scrolls with it like any out-of-flow box.
                let child = &self.context.dom.as_ref().tree()[*child_id];
                let child_transform = if child.taffy_position() == taffy::Position::Fixed
                    && Some(self.node.id) == self.context.root_element_id
                {
                    let scroll = self.context.dom.as_ref().viewport_scroll();
                    parent_style_transform.pre_translate(kurbo::Vec2 {
                        x: scroll.x * self.scale,
                        y: scroll.y * self.scale,
                    })
                } else {
                    parent_style_transform
                };
                self.render_node(scene, *child_id, child_transform, clip_rect);
            }
        }

        // Positive z_index hoisted nodes
        if let Some(hoisted) = &self.node.stacking_context {
            for hoisted_child in hoisted.pos_z_hoisted_children() {
                let position = hoisted_child.position(self.node.tree(), self.node.id);
                let pos = kurbo::Vec2 {
                    x: position.x as f64 * self.scale,
                    y: position.y as f64 * self.scale,
                };
                self.render_node(
                    scene,
                    hoisted_child.node_id,
                    parent_style_transform.pre_translate(pos),
                    clip_rect,
                );
            }
        }
    }

    #[cfg(feature = "svg")]
    fn draw_svg(&self, scene: &mut impl PaintScene) {
        use style::properties::generated::longhands::object_fit::computed_value::T as ObjectFit;

        let Some(svg) = self.svg else {
            return;
        };

        let width = self.frame.content_box.width() as f32;
        let height = self.frame.content_box.height() as f32;
        let svg_size = svg.tree.size();

        let x = self.frame.content_box.origin().x;
        let y = self.frame.content_box.origin().y;

        // An SVG with an aspect ratio but no natural size is sized by the default sizing
        // algorithm, which for `none` and `scale-down` contains it within the content box.
        let object_fit = match self.style.clone_object_fit() {
            ObjectFit::None | ObjectFit::ScaleDown
                if svg.intrinsic_width().is_none()
                    && svg.intrinsic_height().is_none()
                    && svg.viewbox_aspect_ratio().is_some() =>
            {
                ObjectFit::Contain
            }
            object_fit => object_fit,
        };
        let object_position = self.style.clone_object_position();

        // Apply object-fit algorithm
        let container_size = taffy::Size { width, height };
        let object_size = taffy::Size {
            width: svg_size.width(),
            height: svg_size.height(),
        };
        let paint_size = compute_object_fit(container_size, Some(object_size), object_fit);

        // Compute object-position
        let x_offset = object_position.horizontal.resolve(
            CSSPixelLength::new(container_size.width - paint_size.width) / self.scale as f32,
        ) * self.scale as f32;
        let y_offset = object_position.vertical.resolve(
            CSSPixelLength::new(container_size.height - paint_size.height) / self.scale as f32,
        ) * self.scale as f32;
        let x = x + x_offset.px() as f64;
        let y = y + y_offset.px() as f64;

        let viewport = svg_viewport_affine(svg, paint_size.width, paint_size.height);
        let transform = (self.transform * viewport).then_translate(Vec2 { x, y });

        self.with_replaced_content_clip(
            scene,
            container_size,
            paint_size,
            x_offset.px(),
            y_offset.px(),
            |scene| {
                anyrender_svg::render_svg_tree(scene, &svg.tree, transform);
            },
        );
    }

    /// Clip replaced content to the content box when its object-fit/object-position
    /// rect overflows it.
    fn with_replaced_content_clip<S: PaintScene>(
        &self,
        scene: &mut S,
        container_size: taffy::Size<f32>,
        paint_size: taffy::Size<f32>,
        x_offset: f32,
        y_offset: f32,
        paint: impl FnOnce(&mut S),
    ) {
        let overflows = x_offset < 0.0
            || y_offset < 0.0
            || x_offset + paint_size.width > container_size.width
            || y_offset + paint_size.height > container_size.height;
        self.context.layer_manager.maybe_with_layer(
            scene,
            overflows,
            1.0,
            self.transform,
            &self.frame.content_box_path(),
            None,
            None,
            paint,
        );
    }

    /// [fork] An embedder's surface canvas (`BaseDocument::native_surfaces`): its content box cleared to
    /// transparent, so the surface composited under the page shows there; what paints above it still draws.
    fn draw_native_surface(&self, scene: &mut impl PaintScene) {
        if !self.context.dom.native_surfaces.contains(&self.node.id) {
            return;
        }
        let rect = self.frame.content_box;
        let clear = peniko::BlendMode::new(peniko::Mix::Normal, peniko::Compose::Clear);
        scene.push_layer(Fill::NonZero, clear, 1.0, self.transform, &rect, None, None);
        scene.fill(Fill::NonZero, self.transform, peniko::Color::BLACK, None, &rect);
        scene.pop_layer();
    }

    fn draw_image(&self, scene: &mut impl PaintScene) {
        if let Some(image) = self.element.raster_image_data() {
            let width = self.frame.content_box.width() as u32;
            let height = self.frame.content_box.height() as u32;
            let x = self.frame.content_box.origin().x;
            let y = self.frame.content_box.origin().y;

            let object_fit = self.style.clone_object_fit();
            let object_position = self.style.clone_object_position();
            let image_rendering = self.style.clone_image_rendering();
            let quality = to_image_quality(image_rendering);

            // Apply object-fit algorithm
            let container_size = taffy::Size {
                width: width as f32,
                height: height as f32,
            };
            let object_size = taffy::Size {
                width: image.width as f32,
                height: image.height as f32,
            };
            let paint_size = compute_object_fit(container_size, Some(object_size), object_fit);

            // Compute object-position
            let x_offset = object_position.horizontal.resolve(
                CSSPixelLength::new(container_size.width - paint_size.width) / self.scale as f32,
            ) * self.scale as f32;
            let y_offset = object_position.vertical.resolve(
                CSSPixelLength::new(container_size.height - paint_size.height) / self.scale as f32,
            ) * self.scale as f32;
            let x = x + x_offset.px() as f64;
            let y = y + y_offset.px() as f64;

            let x_scale = paint_size.width as f64 / object_size.width as f64;
            let y_scale = paint_size.height as f64 / object_size.height as f64;
            let transform = self
                .transform
                .pre_translate(Vec2 { x, y })
                .pre_scale_non_uniform(x_scale, y_scale);

            self.with_replaced_content_clip(
                scene,
                container_size,
                paint_size,
                x_offset.px(),
                y_offset.px(),
                |scene| {
                    scene.draw_image(to_peniko_image(image, quality).as_ref(), transform);
                },
            );
        }
    }

    #[cfg(feature = "custom-widget")]
    fn draw_custom_widget(&self, scene: &mut impl PaintScene) {
        if let Some(widget_scene) = self.custom_widget_scene {
            let x = self.frame.content_box.origin().x;
            let y = self.frame.content_box.origin().y;
            let transform = self.transform.then_translate(Vec2 { x, y });

            // TODO: eliminate clone
            scene.append_scene(widget_scene.clone(), transform);
        }
    }

    fn draw_sub_document(&self, scene: &mut impl PaintScene) {
        if let Some(sub_doc) = self.element.sub_doc_data().map(|doc| doc.inner()) {
            let scale = self.scale;
            let width = self.frame.content_box.width() as u32;
            let height = self.frame.content_box.height() as u32;

            // TODO: Support arbitrary transforms of subdocuments
            let translation = self.transform.translation();
            let initial_x = translation.x + self.frame.content_box.origin().x;
            let initial_y = translation.y + self.frame.content_box.origin().y;
            // let transform = self.transform.then_translate(Vec2 { x, y });

            let painter = BlitzDomPainter::new(
                &sub_doc,
                scale,
                width,
                height,
                initial_x,
                initial_y,
                self.custom_widget_scenes,
            );
            painter.paint_scene(scene);
        }
    }

    fn stroke_devtools(&self, scene: &mut impl PaintScene) {
        if self.devtools.show_layout {
            let shape = &self.frame.border_box;
            let stroke = Stroke::new(self.scale);

            let stroke_color = match self.node.taffy_display() {
                taffy::Display::Block | taffy::Display::FlowRoot => {
                    Color::new([1.0, 0.0, 0.0, 1.0])
                }
                taffy::Display::Flex => Color::new([0.0, 1.0, 0.0, 1.0]),
                taffy::Display::Grid => Color::new([0.0, 0.0, 1.0, 1.0]),
                taffy::Display::None => Color::new([0.0, 0.0, 1.0, 1.0]),
            };

            scene.stroke(&stroke, self.transform, stroke_color, None, &shape);
        }
    }
}
impl<'dom, 'a> std::ops::Deref for ElementCx<'dom, 'a> {
    type Target = BlitzDomPainter<'dom, 'a>;
    fn deref(&self) -> &Self::Target {
        self.context
    }
}

fn insets_from_taffy_rect(input: taffy::Rect<f64>) -> Insets {
    Insets {
        x0: input.left,
        y0: input.top,
        x1: input.right,
        y1: input.bottom,
    }
}

/// Convert Stylo and Taffy types into Kurbo types
fn create_css_rect(style: &ComputedValues, layout: &Layout, scale: f64) -> CssBox {
    // Resolve and rescale
    // We have to scale since document pixels are not same same as rendered pixels
    let width: f64 = layout.size.width as f64;
    let height: f64 = layout.size.height as f64;
    let border_box = Rect::new(0.0, 0.0, width * scale, height * scale);
    // The border widths Stylo computed (already snapped to whole device pixels), not Taffy's: Taffy rounds each edge of
    // a box to whole CSS pixels on its own, so at a fractional scale a 1px border (2.625 -> 2 device px, 0.76 CSS px)
    // came out 1 on one side and 0 on the other, and a round ring painted thick on the left and missing on the right
    // (a small round icon on a phone). Laid-out boxes keep Taffy's positions.
    // A side whose style is none or hidden has no border: Stylo's computed width stays `medium` (3px) there, zeroed
    // only in the resolved value (getComputedStyle), so read as is it inset every border-less box's padding box by
    // 3px: overflow clips cut the first letter of a clipped line and padding-box backgrounds shrank (native 2026-11-24).
    let s_widths = style.get_border();
    let side = |width: &style::values::computed::BorderSideWidth, style: style::values::computed::BorderStyle| {
        if style.none_or_hidden() { 0.0 } else { width.0.to_f64_px() * scale }
    };
    let border = Insets {
        x0: side(&s_widths.border_left_width, s_widths.border_left_style),
        y0: side(&s_widths.border_top_width, s_widths.border_top_style),
        x1: side(&s_widths.border_right_width, s_widths.border_right_style),
        y1: side(&s_widths.border_bottom_width, s_widths.border_bottom_style),
    };
    let _ = insets_from_taffy_rect;
    let padding = insets_from_taffy_rect(layout.padding.map(|p| p as f64 * scale));
    let outline_width = style.get_outline().outline_width.0.to_f64_px() * scale;

    // Resolve the radii to a length. need to downscale since the radii are in document pixels
    let resolve_w = CSSPixelLength::new(width as _);
    let resolve_h = CSSPixelLength::new(height as _);
    let resolve_radii = |radius: &BorderCornerRadius| -> Vec2 {
        Vec2 {
            x: scale * radius.0.width.0.resolve(resolve_w).px() as f64,
            y: scale * radius.0.height.0.resolve(resolve_h).px() as f64,
        }
    };
    let s_border = style.get_border();
    let border_radii = NonUniformRoundedRectRadii {
        top_left: resolve_radii(&s_border.border_top_left_radius),
        top_right: resolve_radii(&s_border.border_top_right_radius),
        bottom_right: resolve_radii(&s_border.border_bottom_right_radius),
        bottom_left: resolve_radii(&s_border.border_bottom_left_radius),
    };

    CssBox::new(border_box, border, padding, outline_width, border_radii)
}
