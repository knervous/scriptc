use blitz_dom::util::ToColorColor as _;
use style::color::AbsoluteColor;
pub(crate) use style::computed_values::filter::single_value::T as StyloFilter;

use anyrender::filters::{Filter, FilterEffect};

/// [fork] `scale`: device pixels per CSS pixel. The painter lays boxes out in device pixels and its transforms carry
/// no scale, so a filter's lengths (blur, a shadow's offsets and blur) are scaled here; they were CSS pixels drawn as
/// device pixels, every blur and glow 1/scale of its size on a phone (2026-11-23).
pub(crate) fn convert_filters(filters: &[StyloFilter], scale: f64) -> Option<Filter> {
    if filters.is_empty() {
        return None;
    }

    Some(Filter::linear_list(
        filters.iter().filter_map(|f| convert_single_filter(f, scale as f32)),
    ))
}

pub(crate) fn convert_single_filter(filter: &StyloFilter, scale: f32) -> Option<FilterEffect> {
    Some(match filter {
        StyloFilter::Blur(radius) => FilterEffect::blur(radius.px() * scale),
        StyloFilter::Brightness(amount) => FilterEffect::brightness(amount.0),
        StyloFilter::Contrast(amount) => FilterEffect::contrast(amount.0),
        StyloFilter::Grayscale(amount) => FilterEffect::grayscale(amount.0),
        StyloFilter::HueRotate(angle) => FilterEffect::hue_rotate(angle.radians()),
        StyloFilter::Invert(amount) => FilterEffect::invert(amount.0),
        StyloFilter::Opacity(amount) => FilterEffect::opacity(amount.0),
        StyloFilter::Saturate(amount) => FilterEffect::saturate(amount.0),
        StyloFilter::Sepia(amount) => FilterEffect::sepia(amount.0),
        StyloFilter::DropShadow(shadow) => FilterEffect::drop_shadow(
            shadow.horizontal.px() * scale,
            shadow.vertical.px() * scale,
            // [fork] A shadow's blur radius is twice its Gaussian's standard deviation (CSS Filter Effects,
            // drop-shadow(): "the standard deviation ... is equal to half the blur radius"), as Chrome draws it.
            shadow.blur.px() / 2.0 * scale,
            // TODO: pass in correct currentColor
            shadow
                .color
                .resolve_to_absolute(&AbsoluteColor::BLACK)
                .as_color_color(),
        ),
        StyloFilter::Url(_) => return None,
    })
}
