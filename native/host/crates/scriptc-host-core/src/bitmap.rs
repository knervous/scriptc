//! The host's ImageBitmap: what a layer's image decode answers (modules.rs). The
//! pixels are decoded RGBA8 rows, straight or premultiplied as asked. Compiled code reads `width` and `height` and calls
//! `close()` (objects.rs `Kind::Image`); copyExternalImageToTexture reads the pixels through a layer's scene
//! imagePixels, which converts the alpha to what the destination asks for.

use std::cell::RefCell;
use std::sync::Arc;

pub struct Pixels {
    pub width: u32,
    pub height: u32,
    /// RGBA8 rows, top first.
    pub rgba: Arc<Vec<u8>>,
    pub premultiplied: bool,
}

impl Clone for Pixels {
    fn clone(&self) -> Pixels {
        Pixels { width: self.width, height: self.height, rgba: self.rgba.clone(), premultiplied: self.premultiplied }
    }
}

/// An ImageBitmap; `close()` releases its pixels (its size reads 0 after).
pub type Bitmap = RefCell<Option<Pixels>>;

/// Decodes PNG / JPEG / WebP bytes (the format sniffed from the bytes, as createImageBitmap does with a blob) to RGBA8,
/// premultiplied if asked. No color space conversion (colorSpaceConversion "none") and no EXIF rotation.
pub fn decode(bytes: &[u8], premultiply: bool) -> Result<Pixels, String> {
    let image = image::load_from_memory(bytes).map_err(|e| format!("the image cannot be decoded ({e})"))?;
    let rgba = image.to_rgba8();
    let (width, height) = rgba.dimensions();
    let mut rgba = rgba.into_raw();
    if premultiply {
        premultiply_rows(&mut rgba);
    }
    Ok(Pixels { width, height, rgba: Arc::new(rgba), premultiplied: premultiply })
}

pub fn premultiply_rows(rgba: &mut [u8]) {
    for p in rgba.chunks_exact_mut(4) {
        let a = p[3] as u32;
        for c in &mut p[..3] {
            *c = ((*c as u32 * a + 127) / 255) as u8;
        }
    }
}

pub fn unpremultiply_rows(rgba: &mut [u8]) {
    for p in rgba.chunks_exact_mut(4) {
        let a = p[3] as u32;
        if a != 0 && a != 255 {
            for c in &mut p[..3] {
                *c = ((*c as u32 * 255 + a / 2) / a).min(255) as u8;
            }
        }
    }
}

/// `imagePixels(source, x, y, w, h, flipY, premultiplied)`: the rect's rows of an
/// ImageBitmap or a decoded <img>, flipped if asked, in the destination's alpha. Err is (DOMException name, message).
pub fn rect_pixels(source: &Pixels, rect: [f64; 4], flip_y: bool, premultiplied: bool) -> Result<Vec<u8>, (&'static str, String)> {
    // WebIDL [EnforceRange]-style: integral pixel coordinates.
    let [x, y, w, h] = rect.map(|v| if v.is_finite() { v.trunc().max(0.0) as u32 } else { 0 });
    let (width, height) = (source.width, source.height);
    if x.checked_add(w).is_none_or(|r| r > width) || y.checked_add(h).is_none_or(|b| b > height) {
        return Err(("OperationError", format!("imagePixels: {w}x{h} at ({x}, {y}) is outside the {width}x{height} image")));
    }
    let (stride, row) = (width as usize * 4, w as usize * 4);
    let mut out = Vec::with_capacity(row * h as usize);
    for r in 0..h as usize {
        let sy = y as usize + if flip_y { h as usize - 1 - r } else { r };
        let start = sy * stride + x as usize * 4;
        out.extend_from_slice(&source.rgba[start..start + row]);
    }
    // The destination's alpha, from the source's.
    match (source.premultiplied, premultiplied) {
        (false, true) => premultiply_rows(&mut out),
        (true, false) => unpremultiply_rows(&mut out),
        _ => {}
    }
    Ok(out)
}
