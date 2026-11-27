//! [fork] `border-image` (CSS Backgrounds 3 §6): the source image (a raster `url()` or a gradient) cut into
//! nine parts by `border-image-slice` and drawn into the border image area (the border box grown by
//! `border-image-outset`), its edges and middle stretched, repeated, rounded or spaced per `border-image-repeat`.
//! Drawn in place of the element's border styles, as browsers do once the image is ready.

use super::{ElementCx, to_image_quality, to_peniko_image};
use crate::gradient::to_peniko_gradient;
use anyrender::PaintScene;
use blitz_dom::node::ImageData;
use kurbo::{Affine, Insets, Rect};
use peniko::Fill;
use style::values::{
    computed::{Image as ComputedImage, NumberOrPercentage},
    generics::{border::BorderImageSideWidth, image::GenericImage, length::GenericLengthOrNumber},
    specified::border::BorderImageRepeatKeyword,
};

/// What the nine parts are cut from.
enum Source<'a> {
    Raster(&'a blitz_dom::node::RasterImageData),
    Gradient(&'a style::values::computed::Gradient),
}

/// The properties a nine-slice image is drawn from: `border-image-*`, or `mask-border-*` (the same value types).
pub(super) struct NineSlice<'a> {
    pub source: &'a ComputedImage,
    pub data: Option<&'a blitz_dom::node::ImageResourceData>,
    pub slice: &'a style::values::computed::BorderImageSlice,
    pub width: &'a style::values::computed::BorderImageWidth,
    pub outset: &'a style::values::computed::NonNegativeLengthOrNumberRect,
    pub repeat: &'a style::values::specified::border::BorderImageRepeat,
}

impl ElementCx<'_, '_> {
    /// Draw the element's `border-image`, if it has one ready. True when it drew (the border styles are then not
    /// drawn).
    pub(super) fn draw_border_image(&self, scene: &mut impl PaintScene) -> bool {
        let border = self.style.get_border();
        self.draw_nine_slice(
            scene,
            &NineSlice {
                source: &border.border_image_source,
                data: self.element.border_images.first().and_then(Option::as_ref),
                slice: &border.border_image_slice,
                width: &border.border_image_width,
                outset: &border.border_image_outset,
                repeat: &border.border_image_repeat,
            },
        )
    }

    /// The element's `mask-border` image, if it has one (an alpha mask, drawn into the mask layer).
    pub(super) fn mask_border(&self) -> Option<NineSlice<'_>> {
        let svg = self.style.get_svg();
        if matches!(svg.mask_border_source, ComputedImage::None) {
            return None;
        }
        Some(NineSlice {
            source: &svg.mask_border_source,
            data: self.element.mask_border_images.first().and_then(Option::as_ref),
            slice: &svg.mask_border_slice,
            width: &svg.mask_border_width,
            outset: &svg.mask_border_outset,
            repeat: &svg.mask_border_repeat,
        })
    }

    /// Draw a nine-slice image (CSS Backgrounds 3 §6) into the element's border image area. True when it drew.
    pub(super) fn draw_nine_slice(&self, scene: &mut impl PaintScene, image: &NineSlice) -> bool {
        let (source, image_w, image_h) = match image.source {
            ComputedImage::None => return false,
            GenericImage::Url(_) => {
                let Some(data) = image.data else {
                    return false;
                };
                let ImageData::Raster(raster) = &data.image else {
                    return false;
                };
                (Source::Raster(raster), raster.width as f64, raster.height as f64)
            }
            GenericImage::Gradient(gradient) => (Source::Gradient(gradient), 0.0, 0.0),
            _ => return false,
        };

        let scale = self.scale;
        let widths = self.frame.border_width;
        let border_box = self.frame.border_box;

        // border-image-outset: a number is a multiple of the border width, a length is a length.
        let outset_side = |v: &style::values::computed::NonNegativeLengthOrNumber, side_width: f64| match v {
            GenericLengthOrNumber::Number(n) => n.0 as f64 * side_width,
            GenericLengthOrNumber::Length(l) => l.0.px() as f64 * scale,
        };
        let o = image.outset;
        let outset = Insets {
            y0: outset_side(&o.0, widths.y0),
            x1: outset_side(&o.1, widths.x1),
            y1: outset_side(&o.2, widths.y1),
            x0: outset_side(&o.3, widths.x0),
        };
        let area = border_box + outset;
        if area.width() <= 0.0 || area.height() <= 0.0 {
            return true;
        }

        // A gradient has no intrinsic size: it takes the border image area's. Its units are device pixels; a raster's
        // are its own pixels (CSS pixels at 1x).
        let (image_w, image_h, unit) = match source {
            Source::Gradient(_) => (area.width(), area.height(), scale),
            Source::Raster(_) => (image_w, image_h, 1.0),
        };
        if image_w <= 0.0 || image_h <= 0.0 {
            return true;
        }

        // border-image-slice: numbers in image units, percentages of the image's size; clamped to it.
        let slice_side = |v: &NumberOrPercentage, extent: f64| -> f64 {
            match v {
                NumberOrPercentage::Number(n) => *n as f64 * unit,
                NumberOrPercentage::Percentage(p) => p.0 as f64 * extent,
            }
            .clamp(0.0, extent)
        };
        let s = image.slice;
        let slice = Insets {
            y0: slice_side(&s.offsets.0.0, image_h),
            x1: slice_side(&s.offsets.1.0, image_w),
            y1: slice_side(&s.offsets.2.0, image_h),
            x0: slice_side(&s.offsets.3.0, image_w),
        };
        let fill_middle = s.fill;

        // border-image-width: a number is a multiple of the border width, a length-percentage resolves against the
        // area, `auto` is the slice's own size.
        let width_side = |v: &style::values::computed::BorderImageSideWidth, side_width: f64, extent: f64, slice: f64| {
            match v {
                BorderImageSideWidth::Number(n) => n.0 as f64 * side_width,
                BorderImageSideWidth::LengthPercentage(lp) => {
                    lp.0.resolve(style::values::computed::CSSPixelLength::new((extent / scale) as f32)).px() as f64 * scale
                }
                BorderImageSideWidth::Auto => slice / unit * scale,
            }
            .max(0.0)
        };
        let w = image.width;
        let mut dest = Insets {
            y0: width_side(&w.0, widths.y0, area.height(), slice.y0),
            x1: width_side(&w.1, widths.x1, area.width(), slice.x1),
            y1: width_side(&w.2, widths.y1, area.height(), slice.y1),
            x0: width_side(&w.3, widths.x0, area.width(), slice.x0),
        };
        // Opposite widths that overlap are scaled down together (§6.2).
        let f = [area.width() / (dest.x0 + dest.x1), area.height() / (dest.y0 + dest.y1)]
            .into_iter()
            .filter(|f| f.is_finite())
            .fold(1.0_f64, f64::min);
        if f < 1.0 {
            dest = Insets { x0: dest.x0 * f, y0: dest.y0 * f, x1: dest.x1 * f, y1: dest.y1 * f };
        }

        let repeat = image.repeat;
        let (repeat_h, repeat_v) = (repeat.0, repeat.1);

        let quality = to_image_quality(self.style.clone_image_rendering());
        let current_color = self.style.clone_color();
        let gradient = match source {
            Source::Gradient(g) => Some(to_peniko_gradient(
                g,
                Rect::new(0.0, 0.0, image_w, image_h),
                Rect::new(0.0, 0.0, image_w, image_h),
                scale,
                &current_color,
            )),
            Source::Raster(_) => None,
        };
        let raster_brush = match source {
            Source::Raster(r) => Some(to_peniko_image(r, quality)),
            Source::Gradient(_) => None,
        };

        // Image-space x and y cuts, destination x and y cuts.
        let sx = [0.0, slice.x0, image_w - slice.x1, image_w];
        let sy = [0.0, slice.y0, image_h - slice.y1, image_h];
        let dx = [area.x0, area.x0 + dest.x0, area.x1 - dest.x1, area.x1];
        let dy = [area.y0, area.y0 + dest.y0, area.y1 - dest.y1, area.y1];

        // The middle's scale follows the top (else bottom) edge horizontally and the left (else right) edge vertically.
        let edge_scale = |d: f64, s: f64| if d > 0.0 && s > 0.0 { Some(d / s) } else { None };
        let middle_sx = edge_scale(dest.y0, slice.y0).or(edge_scale(dest.y1, slice.y1));
        let middle_sy = edge_scale(dest.x0, slice.x0).or(edge_scale(dest.x1, slice.x1));

        for row in 0..3 {
            for col in 0..3 {
                if row == 1 && col == 1 && !fill_middle {
                    continue;
                }
                let src = Rect::new(sx[col], sy[row], sx[col + 1], sy[row + 1]);
                let dst = Rect::new(dx[col], dy[row], dx[col + 1], dy[row + 1]);
                if src.width() <= 0.0 || src.height() <= 0.0 || dst.width() <= 0.0 || dst.height() <= 0.0 {
                    continue;
                }
                // Tile size along each axis: corners stretch; an edge keeps its aspect from the cross-axis scale.
                let (tile_w, mode_h) = match col {
                    1 => {
                        let cross = match row {
                            0 | 2 => Some(dst.height() / src.height()),
                            _ => middle_sx,
                        };
                        (cross.map_or(dst.width(), |c| src.width() * c), repeat_h)
                    }
                    _ => (dst.width(), BorderImageRepeatKeyword::Stretch),
                };
                let (tile_h, mode_v) = match row {
                    1 => {
                        let cross = match col {
                            0 | 2 => Some(dst.width() / src.width()),
                            _ => middle_sy,
                        };
                        (cross.map_or(dst.height(), |c| src.height() * c), repeat_v)
                    }
                    _ => (dst.height(), BorderImageRepeatKeyword::Stretch),
                };
                let Some(xs) = tiles(mode_h, dst.width(), tile_w) else { continue };
                let Some(ys) = tiles(mode_v, dst.height(), tile_h) else { continue };
                let clip = xs.partial || ys.partial;
                if clip {
                    scene.push_clip_layer(Fill::NonZero, self.transform, &dst);
                }
                for j in 0..ys.count {
                    for i in 0..xs.count {
                        let x = dst.x0 + xs.start + i as f64 * xs.stride;
                        let y = dst.y0 + ys.start + j as f64 * ys.stride;
                        let t = self.transform
                            * Affine::translate((x, y))
                            * Affine::scale_non_uniform(xs.tile / src.width(), ys.tile / src.height())
                            * Affine::translate((-src.x0, -src.y0));
                        if let Some(brush) = &raster_brush {
                            scene.fill(Fill::NonZero, t, brush.as_ref(), None, &src);
                        } else if let Some((gradient, gradient_transform)) = &gradient {
                            scene.fill(
                                Fill::NonZero,
                                t,
                                anyrender::Paint::Gradient(gradient),
                                *gradient_transform,
                                &src,
                            );
                        }
                    }
                }
                if clip {
                    scene.pop_layer();
                }
            }
        }
        true
    }
}

/// The tiles of one part along one axis.
struct Tiles {
    start: f64,
    stride: f64,
    tile: f64,
    count: usize,
    /// Tiles overhang the part (`repeat`): it clips them.
    partial: bool,
}

fn tiles(mode: BorderImageRepeatKeyword, len: f64, tile: f64) -> Option<Tiles> {
    use BorderImageRepeatKeyword::*;
    if !(len > 0.0) || !(tile > 0.0) {
        return None;
    }
    let one = Tiles { start: 0.0, stride: len, tile: len, count: 1, partial: false };
    Some(match mode {
        Stretch => one,
        Round => {
            let n = (len / tile).round().max(1.0);
            Tiles { start: 0.0, stride: len / n, tile: len / n, count: n as usize, partial: false }
        }
        Repeat => {
            // One tile centred, the rest repeating out from it.
            let first = (len - tile) / 2.0;
            let before = (first / tile).ceil().max(0.0);
            let start = first - before * tile;
            let count = ((len - start) / tile).ceil().max(1.0) as usize;
            if count > 4096 {
                return None;
            }
            Tiles { start, stride: tile, tile, count, partial: start < 0.0 || start + count as f64 * tile > len + 1e-6 }
        }
        Space => {
            let n = (len / tile).floor();
            if n < 1.0 {
                return None;
            }
            if n > 4096.0 {
                return None;
            }
            let gap = (len - n * tile) / (n + 1.0);
            Tiles { start: gap, stride: tile + gap, tile, count: n as usize, partial: false }
        }
    })
}
