//! WAV (RIFF WAVE): integer PCM of 8 (unsigned), 16, 24 and 32 bits, and IEEE float of 32 and 64 bits, plain or
//! WAVE_FORMAT_EXTENSIBLE. Integers scale to [-1, 1) by their full range, as Chrome's decoder does.

/// A decoded WAV: its rate and planar f32 channels.
pub struct Wav {
    pub sample_rate: u32,
    pub channels: Vec<Vec<f32>>,
}

const PCM: u16 = 1;
const FLOAT: u16 = 3;
const EXTENSIBLE: u16 = 0xfffe;

fn u16_at(b: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([b[at], b[at + 1]])
}

fn u32_at(b: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([b[at], b[at + 1], b[at + 2], b[at + 3]])
}

pub fn is_wav(bytes: &[u8]) -> bool {
    bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WAVE"
}

pub fn decode(bytes: &[u8]) -> Result<Wav, String> {
    if !is_wav(bytes) {
        return Err("not a RIFF WAVE file".into());
    }
    let mut fmt: Option<(u16, usize, u32, usize)> = None;
    let mut data: Option<&[u8]> = None;
    let mut pos = 12usize;
    // The chunks, each padded to an even length. A data chunk whose size runs past the file (a recording cut short, or
    // a streamed header's placeholder size) is read to the end of the file.
    while pos + 8 <= bytes.len() {
        let id = &bytes[pos..pos + 4];
        let size = u32_at(bytes, pos + 4) as usize;
        let body_start = pos + 8;
        let body_end = body_start.saturating_add(size).min(bytes.len());
        let body = &bytes[body_start..body_end];
        match id {
            b"fmt " => {
                if body.len() < 16 {
                    return Err("WAV fmt chunk too short".into());
                }
                let mut tag = u16_at(body, 0);
                let channels = u16_at(body, 2) as usize;
                let rate = u32_at(body, 4);
                let bits = u16_at(body, 14) as usize;
                if tag == EXTENSIBLE {
                    // The sub-format GUID's first two bytes are the format tag.
                    if body.len() < 26 {
                        return Err("WAV extensible fmt chunk too short".into());
                    }
                    tag = u16_at(body, 24);
                }
                fmt = Some((tag, channels, rate, bits));
            }
            b"data" => {
                data = Some(body);
                if fmt.is_some() {
                    break;
                }
            }
            _ => {}
        }
        pos = body_start.saturating_add(size).saturating_add(size & 1);
    }
    let (tag, nch, rate, bits) = fmt.ok_or("WAV has no fmt chunk")?;
    let data = data.ok_or("WAV has no data chunk")?;
    if nch == 0 || nch > 32 {
        return Err(format!("WAV with {nch} channels"));
    }
    let width = match (tag, bits) {
        (PCM, 8 | 16 | 24 | 32) | (FLOAT, 32 | 64) => bits / 8,
        (PCM | FLOAT, _) => return Err(format!("unsupported WAV sample size: {bits} bits")),
        _ => return Err(format!("unsupported WAV format tag {tag:#x}")),
    };
    let frame = width * nch;
    // Sized by the data actually present (a declared size past the end of the file counts for nothing above).
    let frames = data.len() / frame;
    let mut channels = (0..nch).map(|_| crate::sample_vec(frames)).collect::<Result<Vec<_>, _>>()?;
    // One sample at a time is fast enough: a minute of stereo is a few milliseconds.
    let sample: fn(&[u8]) -> f32 = match (tag, bits) {
        (PCM, 8) => |s| (s[0] as f32 - 128.0) / 128.0,
        (PCM, 16) => |s| i16::from_le_bytes([s[0], s[1]]) as f32 / 32768.0,
        (PCM, 24) => |s| (i32::from_le_bytes([0, s[0], s[1], s[2]]) >> 8) as f32 / 8_388_608.0,
        (PCM, _) => |s| (i32::from_le_bytes([s[0], s[1], s[2], s[3]]) as f64 / 2_147_483_648.0) as f32,
        (_, 32) => |s| f32::from_le_bytes([s[0], s[1], s[2], s[3]]),
        _ => |s| f64::from_le_bytes(s[..8].try_into().unwrap()) as f32,
    };
    for f in data[..frames * frame].chunks_exact(frame) {
        for (c, s) in channels.iter_mut().zip(f.chunks_exact(width)) {
            c.push(sample(s));
        }
    }
    Ok(Wav { sample_rate: rate, channels })
}
