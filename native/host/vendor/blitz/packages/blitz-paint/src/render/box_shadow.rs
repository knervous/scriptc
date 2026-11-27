use super::ElementCx;
use crate::color::{Color, ToColorColor as _};
use anyrender::PaintScene;
use kurbo::{BezPath, Rect, Shape, Vec2};
use peniko::{Compose, Fill, Mix};

impl ElementCx<'_, '_> {
    pub(super) fn draw_outset_box_shadow(&self, scene: &mut impl PaintScene) {
        let box_shadow = &self.style.get_effects().box_shadow.0;
        let has_outset_shadow = box_shadow.iter().any(|s| !s.inset);
        if !has_outset_shadow {
            return;
        }

        let current_color = self.style.clone_color();
        let opacity = self.style.get_effects().opacity;
        let bg_color = self
            .style
            .get_background()
            .background_color
            .resolve_to_absolute(&current_color)
            .as_srgb_color();
        let bg_is_opaque = bg_color.components[3] >= 1.0;
        let needs_clip = opacity < 1.0 || !bg_is_opaque;

        let max_shadow_rect = box_shadow.iter().fold(Rect::ZERO, |prev, shadow| {
            let x = shadow.base.horizontal.px() as f64 * self.scale;
            let y = shadow.base.vertical.px() as f64 * self.scale;
            let blur = shadow.base.blur.px() as f64 * self.scale;
            let spread = shadow.spread.px() as f64 * self.scale;
            let offset = spread + blur * 2.5;

            let rect = self.frame.border_box.inflate(offset, offset) + Vec2::new(x, y);

            prev.union(rect)
        });

        self.context.layer_manager.maybe_with_layer(
            scene,
            needs_clip,
            1.0,
            self.transform,
            &self.frame.shadow_clip(max_shadow_rect),
            None,
            None,
            |scene| {
                for shadow in box_shadow.iter().filter(|s| !s.inset).rev() {
                    let shadow_color = shadow
                        .base
                        .color
                        .resolve_to_absolute(&current_color)
                        .as_srgb_color();

                    let alpha = shadow_color.components[3];
                    if alpha != 0.0 {
                        let transform = self.transform.then_translate(Vec2 {
                            x: shadow.base.horizontal.px() as f64 * self.scale,
                            y: shadow.base.vertical.px() as f64 * self.scale,
                        });

                        let spread = shadow.spread.px() as f64 * self.scale;
                        let blur = shadow.base.blur.px() as f64;

                        // Without blur or spread the shadow is exactly the element's shape,
                        // so fill the border box path directly (preserving individual radii)
                        if blur == 0.0 && spread == 0.0 {
                            scene.fill(
                                Fill::NonZero,
                                transform,
                                shadow_color,
                                None,
                                &self.frame.border_box_path(),
                            );
                            continue;
                        }

                        // TODO draw shadows with matching individual radii instead of averaging
                        let radius = self.frame.border_radii.average();
                        let rect = self.frame.border_box.inflate(spread, spread);

                        // Fill the color
                        scene.draw_box_shadow(transform, rect, shadow_color, radius, blur);
                    }
                }
            },
        )
    }

    pub(super) fn draw_inset_box_shadow(&self, scene: &mut impl PaintScene) {
        let current_color = self.style.clone_color();
        let box_shadow = &self.style.get_effects().box_shadow.0;
        let has_inset_shadow = box_shadow.iter().any(|s| s.inset);
        if !has_inset_shadow {
            return;
        }

        let padding_box = self.frame.padding_box_path();

        for shadow in box_shadow.iter().filter(|s| s.inset) {
            let shadow_color = shadow
                .base
                .color
                .resolve_to_absolute(&current_color)
                .as_srgb_color();
            if shadow_color == Color::TRANSPARENT {
                return;
            }

            // TODO draw shadows with matching individual radii instead of averaging
            let radius = self.frame.border_radii.average();
            let offset = Vec2 {
                x: shadow.base.horizontal.px() as f64,
                y: shadow.base.vertical.px() as f64,
            };
            let transform = self.transform.then_translate(offset);
            // The unshadowed area is the padding box shrunk by the spread radius
            let spread = shadow.spread.px() as f64 * self.scale;
            let hole = self.frame.padding_box.inflate(-spread, -spread);
            let std_dev = shadow.base.blur.px() as f64 * self.scale;

            // [fork] Deeper than three standard deviations, the hole's corner radius and a
            // pixel and a half of antialiasing inside the hole, the hole's blurred coverage is
            // past 0.998: the shadow there is under a thousandth of its colour, nothing an 8-bit
            // target shows. So the shadow's layer clips to the ring outside that interior, and the
            // renderer skips the interior's tiles instead of blending two layers over the whole
            // padding box (two layers per inset shadow were most of a panel-heavy screen's GPU
            // time on Vello).
            // Only when the element's transform has no rotation or scale, so the hole's offset
            // (applied after it) is a plain shift in the clip's space too.
            let [a, b, c, d, _, _] = self.transform.as_coeffs();
            let margin = 3.0 * std_dev + radius + 1.5;
            let interior = (hole + offset)
                .inflate(-margin, -margin)
                .intersect(self.frame.padding_box.inflate(-self.frame.border_radii.max(), -self.frame.border_radii.max()));
            let ring = (a == 1.0 && b == 0.0 && c == 0.0 && d == 1.0 && interior.width() > 0.0 && interior.height() > 0.0).then(|| {
                // The interior wound against the outline: the ring under the nonzero rule.
                let mut ring = BezPath::new();
                ring.extend(padding_box.path_elements(0.1));
                let outer_area = padding_box.area();
                let (x0, y0, x1, y1) = (interior.x0, interior.y0, interior.x1, interior.y1);
                let corners = if outer_area > 0.0 { [(x0, y0), (x0, y1), (x1, y1), (x1, y0)] } else { [(x0, y0), (x1, y0), (x1, y1), (x0, y1)] };
                ring.move_to(corners[0]);
                for &c in &corners[1..] {
                    ring.line_to(c);
                }
                ring.close_path();
                ring
            });
            let clip = ring.as_ref().unwrap_or(&padding_box);

            scene.push_layer(
                Fill::NonZero,
                Mix::Normal,
                1.0,
                self.transform,
                clip,
                None,
                None,
            );
            scene.fill(
                Fill::NonZero,
                self.transform,
                shadow_color,
                None,
                &padding_box,
            );

            // The erasing layer covers the whole padding box: clipped to the ring too, its partial
            // coverage on the ring's inner edge would erase only part of the colour there.
            scene.push_layer(
                Fill::NonZero,
                Compose::DestOut,
                1.0,
                self.transform,
                &padding_box,
                None,
                None,
            );
            scene.draw_box_shadow(
                transform,
                hole,
                Color::WHITE,
                radius,
                std_dev,
            );

            scene.pop_layer();
            scene.pop_layer();
        }
    }
}
