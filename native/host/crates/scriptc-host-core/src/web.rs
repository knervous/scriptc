//! The window's plain functions natively:
//! `parseInt` / `parseFloat` as ECMAScript defines them, `atob` / `btoa` (forgiving base64 over Latin1 code units), and
//! `crypto.randomUUID()` (an RFC 9562 version 4 UUID from the OS's generator).

const BASE64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// `btoa`: None when a code unit is outside Latin1.
pub fn btoa(units: &[u16]) -> Option<Vec<u16>> {
    let bytes: Vec<u8> = units.iter().map(|&u| u8::try_from(u).ok()).collect::<Option<_>>()?;
    let mut out = Vec::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = (u32::from(chunk[0]) << 16) | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8) | u32::from(*chunk.get(2).unwrap_or(&0));
        for i in 0..4 {
            out.push(if i <= chunk.len() { u16::from(BASE64[(n >> (18 - 6 * i)) as usize & 63]) } else { u16::from(b'=') });
        }
    }
    Some(out)
}

/// `atob` (forgiving-base64 decode: ASCII white space dropped; one or two trailing '=' when the length is a multiple of
/// 4): None when the input is not base64.
pub fn atob(units: &[u16]) -> Option<Vec<u16>> {
    let mut data: Vec<u16> = units.iter().copied().filter(|u| !matches!(u, 0x09 | 0x0A | 0x0C | 0x0D | 0x20)).collect();
    if data.len() % 4 == 0 {
        for _ in 0..2 {
            if data.last() == Some(&u16::from(b'=')) {
                data.pop();
            }
        }
    }
    if data.len() % 4 == 1 {
        return None;
    }
    let mut out = Vec::with_capacity(data.len() * 3 / 4);
    let (mut buffer, mut bits) = (0u32, 0u32);
    for u in data {
        let v = BASE64.iter().position(|&c| u16::from(c) == u)? as u32;
        buffer = (buffer << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push(((buffer >> bits) & 0xFF) as u16);
        }
    }
    Some(out)
}

/// `parseInt(string, radix)`: leading white space and a sign, a 0x prefix for radix 16 (or 0 / absent), then the
/// longest run of digits in the radix; NaN when there is none or the radix is out of range.
pub fn parse_int(text: &str, radix: Option<f64>) -> f64 {
    let s = text.trim_start_matches(|c: char| c.is_whitespace() || c == '\u{feff}');
    let (negative, s) = match s.as_bytes().first() {
        Some(b'-') => (true, &s[1..]),
        Some(b'+') => (false, &s[1..]),
        _ => (false, s),
    };
    let mut radix = radix.filter(|r| r.is_finite()).map_or(0, |r| r.trunc() as i64 as i32);
    let mut s = s;
    if radix != 0 && !(2..=36).contains(&radix) {
        return f64::NAN;
    }
    if (radix == 0 || radix == 16) && (s.starts_with("0x") || s.starts_with("0X")) {
        s = &s[2..];
        radix = 16;
    }
    if radix == 0 {
        radix = 10;
    }
    let digits: Vec<u32> = s.chars().map_while(|c| c.to_digit(radix as u32)).collect();
    if digits.is_empty() {
        return f64::NAN;
    }
    let value = if radix == 10 {
        // Decimal through the float parser: exact rounding for long runs.
        let text: String = digits.iter().map(|d| char::from_digit(*d, 10).unwrap()).collect();
        text.parse::<f64>().unwrap_or(f64::NAN)
    } else {
        digits.iter().fold(0.0f64, |acc, d| acc * f64::from(radix) + f64::from(*d))
    };
    if negative { -value } else { value }
}

/// `parseFloat(string)`: the longest prefix (after white space) that is a decimal literal or Infinity; NaN when none.
pub fn parse_float(text: &str) -> f64 {
    let s = text.trim_start_matches(|c: char| c.is_whitespace() || c == '\u{feff}');
    let b = s.as_bytes();
    let mut i = 0;
    if matches!(b.first(), Some(b'+' | b'-')) {
        i = 1;
    }
    if s[i..].starts_with("Infinity") {
        return if b.first() == Some(&b'-') { f64::NEG_INFINITY } else { f64::INFINITY };
    }
    let start_digits = i;
    while i < b.len() && b[i].is_ascii_digit() {
        i += 1;
    }
    let mut seen = i > start_digits;
    if i < b.len() && b[i] == b'.' {
        let mut j = i + 1;
        while j < b.len() && b[j].is_ascii_digit() {
            j += 1;
        }
        if j > i + 1 || seen {
            seen = seen || j > i + 1;
            i = j;
        }
    }
    if !seen {
        return f64::NAN;
    }
    if i < b.len() && (b[i] == b'e' || b[i] == b'E') {
        let mut j = i + 1;
        if j < b.len() && (b[j] == b'+' || b[j] == b'-') {
            j += 1;
        }
        let exp_start = j;
        while j < b.len() && b[j].is_ascii_digit() {
            j += 1;
        }
        if j > exp_start {
            i = j;
        }
    }
    s[..i].parse::<f64>().unwrap_or(f64::NAN)
}

/// RFC 9562 version 4 (random) UUID, as crypto.randomUUID() formats it.
pub fn random_uuid() -> Result<String, String> {
    let mut b = [0u8; 16];
    getrandom::fill(&mut b).map_err(|e| format!("crypto.randomUUID: {e}"))?;
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let h: String = b.iter().map(|x| format!("{x:02x}")).collect();
    Ok(format!("{}-{}-{}-{}-{}", &h[0..8], &h[8..12], &h[12..16], &h[16..20], &h[20..32]))
}
