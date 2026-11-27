//! MP3 (MPEG-1/2/2.5 Layer III) through Symphonia's pure-Rust reader and decoder (symphonia-bundle-mp3).
//!
//! Gapless: when the first frame is a Xing/Info frame with a LAME tag, the reader takes the encoder delay and padding
//! from it (plus the decoder's own 529-sample delay) and the decoder trims them, so a looped track has no silence or
//! click at its seam. FFmpeg (Chrome's decoder) does the same, and like it, a file without a LAME tag is not trimmed:
//! every frame is decoded, the last included.

use std::io::Cursor;

use symphonia_bundle_mp3::{MpaDecoder, MpaReader};
use symphonia_core::codecs::audio::{AudioDecoder, AudioDecoderOptions};
use symphonia_core::errors::Error;
use symphonia_core::formats::{FormatOptions, FormatReader};
use symphonia_core::io::MediaSourceStream;

/// An MPEG audio Layer III frame header at the start of `b`: the sync, a known version, layer III, and a bitrate and
/// sample rate that are not the reserved values.
fn frame_sync(b: &[u8]) -> bool {
    b.len() >= 4
        && b[0] == 0xff
        && b[1] & 0xe0 == 0xe0
        && (b[1] >> 3) & 3 != 1
        && (b[1] >> 1) & 3 == 1
        && b[2] >> 4 != 15
        && (b[2] >> 2) & 3 != 3
}

/// The bytes after any leading ID3v2 tags (the reader expects a frame first). A tag's size is syncsafe (7 bits a
/// byte) and excludes its 10-byte header and its footer, when the flags say it has one.
fn skip_id3v2(mut b: &[u8]) -> &[u8] {
    while b.len() >= 10 && &b[..3] == b"ID3" {
        let size = b[6..10].iter().fold(0usize, |n, &x| (n << 7) | (x & 0x7f) as usize);
        let footer = if b[5] & 0x10 != 0 { 10 } else { 0 };
        b = &b[(10 + size + footer).min(b.len())..];
    }
    b
}

pub fn is_mp3(bytes: &[u8]) -> bool {
    (bytes.len() >= 10 && &bytes[..3] == b"ID3") || frame_sync(bytes)
}

fn message(e: Error) -> String {
    format!("MP3: {e}")
}

/// Decodes an MP3 file to its sample rate and planar f32.
pub fn decode(bytes: &[u8]) -> Result<(u32, Vec<Vec<f32>>), String> {
    let audio = skip_id3v2(bytes);
    if audio.is_empty() {
        return Err("MP3: an ID3 tag and no audio".into());
    }
    let source = MediaSourceStream::new(Box::new(Cursor::new(audio)), Default::default());
    let mut reader = MpaReader::try_new(source, FormatOptions::default()).map_err(message)?;
    let track = reader.tracks().first().ok_or("MP3: no audio track")?;
    let params = track.codec_params.as_ref().and_then(|p| p.audio()).cloned().ok_or("MP3: no audio track")?;
    // Trimming only with a LAME tag. Without one the reader's length is an estimate from the first frames' bitrate
    // (wrong for VBR), and trimming to it drops real frames: character-select.mp3's last frame was lost that way.
    let lame = track.delay.is_some();
    let rate = params.sample_rate.ok_or("MP3: no sample rate")?;
    let mut options = AudioDecoderOptions::default();
    options.gapless = lame;
    let mut decoder = MpaDecoder::try_new(&params, &options).map_err(message)?;

    let mut channels: Vec<Vec<f32>> = Vec::new();
    let mut frame: Vec<Vec<f32>> = Vec::new();
    let (mut good, mut bad) = (0usize, 0usize);
    loop {
        let packet = match reader.next_packet() {
            Ok(Some(p)) => p,
            Ok(None) => break,
            // A file cut short, or junk after the last frame: what was read still plays.
            Err(Error::IoError(_)) if good > 0 => break,
            Err(e) => return Err(message(e)),
        };
        match decoder.decode(&packet) {
            Ok(buf) => {
                if buf.frames() == 0 {
                    continue;
                }
                buf.copy_to_vecs_planar(&mut frame);
                if channels.is_empty() {
                    channels = vec![Vec::new(); frame.len()];
                }
                if frame.len() != channels.len() {
                    // A channel count that changes mid-stream: those frames are skipped, as a corrupt one is.
                    bad += 1;
                    continue;
                }
                // Capped and grown fallibly: the output grows with the frames, whatever the file's size.
                if (channels[0].len() + frame[0].len()) * channels.len() > crate::MAX_SAMPLES {
                    return Err(format!("MP3: decodes to more than {} samples", crate::MAX_SAMPLES));
                }
                for (c, f) in channels.iter_mut().zip(&frame) {
                    c.try_reserve(f.len()).map_err(|_| "MP3: out of memory")?;
                    c.extend_from_slice(f);
                }
                good += 1;
            }
            // A corrupt frame is skipped (FFmpeg conceals it the same way: the stream goes on).
            Err(Error::DecodeError(_)) => bad += 1,
            Err(e) => return Err(message(e)),
        }
    }
    if good == 0 {
        return Err(format!("MP3: no frame decoded ({bad} corrupt)"));
    }
    Ok((rate, channels))
}
