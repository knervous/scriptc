//! Ogg Opus (RFC 7845) through libopus: the Ogg pages read here, the packets decoded by libopus's multistream
//! decoder (which covers mapping family 0 as one stream too), at 48 kHz, Opus's own rate.
//!
//! What a player owes the stream beyond decoding its packets: the OpusHead pre-skip (the encoder's look-ahead,
//! discarded from the start), the end trim (the last page's granule position says where the audio ends; the final
//! packet decodes a whole frame past it), the start offset (a stream cut from a longer one starts at a granule
//! position above zero), and the OpusHead output gain.

use std::ffi::{CStr, c_char, c_int, c_void};

/// Opus always decodes at 48 kHz here (the rate every granule position counts in).
pub const RATE: u32 = 48_000;
/// The longest Opus packet: 120 ms at 48 kHz.
const MAX_FRAME: usize = 5760;
/// More channels than an AudioBuffer may have (Chrome's limit is 32) is refused.
const MAX_CHANNELS: usize = 32;

unsafe extern "C" {
    fn opus_multistream_decoder_create(
        fs: i32,
        channels: c_int,
        streams: c_int,
        coupled_streams: c_int,
        mapping: *const u8,
        error: *mut c_int,
    ) -> *mut c_void;
    fn opus_multistream_decode_float(st: *mut c_void, data: *const u8, len: i32, pcm: *mut f32, frame_size: c_int, decode_fec: c_int) -> c_int;
    fn opus_multistream_decoder_destroy(st: *mut c_void);
    fn opus_strerror(error: c_int) -> *const c_char;
}

fn opus_error(code: c_int) -> String {
    // SAFETY: opus_strerror returns a static NUL-terminated string for any code.
    unsafe { CStr::from_ptr(opus_strerror(code)) }.to_string_lossy().into_owned()
}

/// The libopus decoder, destroyed on drop.
struct Decoder(*mut c_void);

impl Drop for Decoder {
    fn drop(&mut self) {
        // SAFETY: created by opus_multistream_decoder_create, destroyed once.
        unsafe { opus_multistream_decoder_destroy(self.0) }
    }
}

/// The identification header (RFC 7845 section 5.1).
struct Head {
    channels: usize,
    pre_skip: u64,
    gain_q8: i16,
    streams: u8,
    coupled: u8,
    mapping: Vec<u8>,
}

fn parse_head(p: &[u8]) -> Result<Head, String> {
    if p.len() < 19 || &p[..8] != b"OpusHead" {
        return Err("no OpusHead".into());
    }
    // Version: the major number (high nibble) must be 0; minor versions are compatible.
    if p[8] >> 4 != 0 {
        return Err(format!("unsupported OpusHead version {}", p[8]));
    }
    let channels = p[9] as usize;
    if channels == 0 {
        return Err("OpusHead has zero channels".into());
    }
    let pre_skip = u16::from_le_bytes([p[10], p[11]]) as u64;
    let gain_q8 = i16::from_le_bytes([p[16], p[17]]);
    let family = p[18];
    let (streams, coupled, mapping) = match family {
        0 => {
            if channels > 2 {
                return Err(format!("channel mapping family 0 with {channels} channels"));
            }
            (1, (channels - 1) as u8, (0..channels as u8).collect())
        }
        // Family 1 (Vorbis channel order, up to 8 channels) and 255 (unordered) carry the mapping table; the
        // channels come out in the table's order, as Chrome's do for family 1 (no reordering to a WAV layout).
        _ => {
            if p.len() < 21 + channels {
                return Err("OpusHead channel mapping table truncated".into());
            }
            if family == 1 && channels > 8 {
                return Err(format!("channel mapping family 1 with {channels} channels"));
            }
            if family != 1 && family != 255 {
                return Err(format!("unsupported channel mapping family {family}"));
            }
            let (streams, coupled) = (p[19], p[20]);
            if streams == 0 || coupled > streams || streams as usize + coupled as usize > 255 {
                return Err(format!("bad OpusHead stream counts ({streams} streams, {coupled} coupled)"));
            }
            (streams, coupled, p[21..21 + channels].to_vec())
        }
    };
    if channels > MAX_CHANNELS {
        return Err(format!("{channels} channels (at most {MAX_CHANNELS})"));
    }
    Ok(Head { channels, pre_skip, gain_q8, streams, coupled, mapping })
}

/// One packet of the Opus stream, with the granule position of the page it completed on when it is that page's last.
struct Packet {
    data: Vec<u8>,
    /// Set on the last packet completed on a page: that page's granule position (-1 is "none" and is left None).
    granule: Option<i64>,
}

/// The CRC Ogg pages carry (polynomial 0x04c11db7, unreflected, zero initial value).
fn ogg_crc(parts: &[&[u8]]) -> u32 {
    static TABLE: std::sync::OnceLock<[u32; 256]> = std::sync::OnceLock::new();
    let table = TABLE.get_or_init(|| {
        let mut t = [0u32; 256];
        for (i, e) in t.iter_mut().enumerate() {
            let mut r = (i as u32) << 24;
            for _ in 0..8 {
                r = if r & 0x8000_0000 != 0 { (r << 1) ^ 0x04c1_1db7 } else { r << 1 };
            }
            *e = r;
        }
        t
    });
    parts.iter().flat_map(|p| p.iter()).fold(0u32, |crc, &b| (crc << 8) ^ table[((crc >> 24) as u8 ^ b) as usize])
}

/// The packets of the first Opus logical stream in an Ogg file (other multiplexed streams, such as a Skeleton, are
/// skipped; a chained file's later links are not read). Pages with a bad CRC are refused, as is truncation inside a
/// page; a file cut between pages decodes what it has, as Chrome does.
fn packets(bytes: &[u8]) -> Result<Vec<Packet>, String> {
    let mut out = Vec::new();
    let mut serial: Option<u32> = None;
    let mut partial: Vec<u8> = Vec::new();
    let mut continuing = false;
    let mut pos = 0usize;
    let mut expected_seq: Option<u32> = None;
    while pos + 27 <= bytes.len() {
        if &bytes[pos..pos + 4] != b"OggS" {
            if pos == 0 {
                return Err("not an Ogg file".into());
            }
            return Err(format!("lost Ogg page sync at byte {pos}"));
        }
        let h = &bytes[pos..];
        if h[4] != 0 {
            return Err(format!("unsupported Ogg version {}", h[4]));
        }
        let flags = h[5];
        let granule = i64::from_le_bytes(h[6..14].try_into().unwrap());
        let page_serial = u32::from_le_bytes(h[14..18].try_into().unwrap());
        let seq = u32::from_le_bytes(h[18..22].try_into().unwrap());
        let crc = u32::from_le_bytes(h[22..26].try_into().unwrap());
        let nsegs = h[26] as usize;
        let header_len = 27 + nsegs;
        if pos + header_len > bytes.len() {
            break;
        }
        let lacing = &h[27..header_len];
        let body_len: usize = lacing.iter().map(|&l| l as usize).sum();
        let page_len = header_len + body_len;
        if pos + page_len > bytes.len() {
            // A file cut inside its last page: what came before it still plays.
            if out.is_empty() {
                return Err("Ogg page truncated".into());
            }
            break;
        }
        // The CRC covers the page with its own CRC field taken as zero.
        let page = &bytes[pos..pos + page_len];
        let sum = ogg_crc(&[&page[..22], &[0u8; 4][..], &page[26..]]);
        if sum != crc {
            return Err(format!("Ogg page CRC mismatch at byte {pos}"));
        }
        pos += page_len;

        // The Opus stream is the one whose first packet is OpusHead (on its beginning-of-stream page).
        let body = &bytes[pos - body_len..pos];
        match serial {
            None => {
                if flags & 0x02 != 0 && body.starts_with(b"OpusHead") {
                    serial = Some(page_serial);
                } else {
                    continue;
                }
            }
            Some(s) if s != page_serial => continue,
            Some(_) => {}
        }
        // A missing page (a gap in the sequence numbers) loses the packet that spanned it.
        if let Some(want) = expected_seq
            && want != seq
        {
            partial.clear();
            continuing = false;
        }
        expected_seq = Some(seq.wrapping_add(1));
        // A page that continues a packet whose start was lost skips its leading segments; a page that does not
        // continue one drops any packet left unfinished before it.
        let continued = flags & 0x01 != 0;
        let mut skip_leading = continued && !continuing;
        if !continued || skip_leading {
            partial.clear();
        }
        let first_new = out.len();
        let mut at = 0usize;
        for &l in lacing {
            let seg = &body[at..at + l as usize];
            at += l as usize;
            if !skip_leading {
                partial.extend_from_slice(seg);
            }
            if l < 255 {
                if !skip_leading {
                    out.push(Packet { data: std::mem::take(&mut partial), granule: None });
                }
                skip_leading = false;
            }
        }
        continuing = lacing.last().is_some_and(|&l| l == 255);
        if out.len() > first_new && granule != -1 {
            out.last_mut().unwrap().granule = Some(granule);
        }
        if flags & 0x04 != 0 {
            break;
        }
    }
    if serial.is_none() {
        return Err("no Opus stream in the Ogg file".into());
    }
    Ok(out)
}

/// Decodes an Ogg Opus file to planar f32 at 48 kHz.
pub fn decode(bytes: &[u8]) -> Result<Vec<Vec<f32>>, String> {
    let packets = packets(bytes)?;
    let mut it = packets.into_iter();
    let head = parse_head(&it.next().ok_or("no OpusHead packet")?.data)?;
    let tags = it.next().ok_or("no OpusTags packet")?;
    if !tags.data.starts_with(b"OpusTags") {
        return Err("no OpusTags".into());
    }
    let audio: Vec<Packet> = it.collect();

    let mut error: c_int = 0;
    // SAFETY: the mapping has `channels` entries; libopus validates the counts against it and reports in `error`.
    let raw = unsafe {
        opus_multistream_decoder_create(
            RATE as i32,
            head.channels as c_int,
            head.streams as c_int,
            head.coupled as c_int,
            head.mapping.as_ptr(),
            &mut error,
        )
    };
    if raw.is_null() || error != 0 {
        if !raw.is_null() {
            drop(Decoder(raw));
        }
        return Err(format!("Opus decoder: {}", opus_error(error)));
    }
    let decoder = Decoder(raw);

    let ch = head.channels;
    let mut interleaved: Vec<f32> = Vec::new();
    let mut buf = vec![0f32; MAX_FRAME * ch];
    // The granule position of the end of the stream and where in the decoded samples the stream's granule 0 falls
    // (`start`: positive when the stream starts above granule 0).
    let mut end_granule: Option<i64> = None;
    let mut start: Option<i64> = None;
    let mut decoded: i64 = 0;
    for p in &audio {
        // A zero-length packet carries no duration (libopus would conceal a lost frame of a guessed length), so
        // only its page's granule position counts.
        if !p.data.is_empty() {
            let len = i32::try_from(p.data.len()).map_err(|_| "Opus packet too long")?;
            // SAFETY: buf holds MAX_FRAME frames of `ch` channels, the frame_size passed.
            let got = unsafe { opus_multistream_decode_float(decoder.0, p.data.as_ptr(), len, buf.as_mut_ptr(), MAX_FRAME as c_int, 0) };
            if got < 0 {
                return Err(format!("Opus packet at sample {decoded}: {}", opus_error(got)));
            }
            // The output grows with the packets (a 2-byte packet can say 120 ms), so it is capped and grown fallibly.
            let n = got as usize * ch;
            if interleaved.len() + n > crate::MAX_SAMPLES {
                return Err(format!("decodes to more than {} samples", crate::MAX_SAMPLES));
            }
            interleaved.try_reserve(n).map_err(|_| "out of memory decoding Opus")?;
            interleaved.extend_from_slice(&buf[..n]);
            decoded += got as i64;
        }
        if let Some(g) = p.granule {
            if start.is_none() {
                // The first page that completes audio: its granule position less the samples through it is where
                // the stream starts. Below zero is the end trim of a stream shorter than its first page (allowed on
                // the last page only; elsewhere tolerated as zero, as FFmpeg does).
                start = Some((g - decoded).max(0));
            }
            end_granule = Some(g);
        }
    }
    drop(decoder);

    let total = decoded;
    let start = start.unwrap_or(0);
    // The samples to keep: from the pre-skip to the last granule position (both in the decoder's output, where index
    // i is granule start + i), or to the end of what was decoded when no page said.
    let begin = head.pre_skip as i64;
    let end = end_granule.map(|g| g - start).unwrap_or(total).min(total);
    let frames = (end - begin).max(0) as usize;
    let begin = begin.min(total) as usize;

    // Output gain: Q7.8 dB.
    let gain = if head.gain_q8 != 0 { 10f32.powf(head.gain_q8 as f32 / (20.0 * 256.0)) } else { 1.0 };
    let mut channels = (0..ch).map(|_| crate::sample_vec(frames)).collect::<Result<Vec<_>, _>>()?;
    for frame in interleaved[begin * ch..(begin + frames) * ch].chunks_exact(ch) {
        for (c, s) in channels.iter_mut().zip(frame) {
            c.push(s * gain);
        }
    }
    Ok(channels)
}
