//! decodeAudioData for a native host (the contract; the host's audio.rs calls it off the page thread).
//!
//! The clips it was built for are Ogg Opus (48 kHz sound effects). Chrome's decodeAudioData also
//! takes WAV (PCM 8/16/24/32-bit and float), Ogg Vorbis, MP3 and AAC/M4A; the native host needs Opus, WAV and MP3 (the
//! music), and the others only if a shipped asset is in that format. The result is resampled to the context's rate as Chrome does
//! (a band-limited resampler, not linear), mono stays mono, stereo stays stereo.
//!
//! Opus is decoded by libopus (vendor/libopus, compiled by build.rs), the decoder Chrome uses; the Ogg pages and WAV
//! chunks are read here (opus.rs, wav.rs). MP3 (music, which the native HTMLAudioElement
//! decodes whole through here) is Symphonia's (mp3.rs). resample.rs is the resampler. Nothing here panics on bad input: every
//! failure is an `Err`.

mod mp3;
mod opus;
mod resample;
mod wav;

/// Planar f32 at `sample_rate`, every channel the same length.
#[derive(Debug)]
pub struct Decoded {
    pub sample_rate: f32,
    pub channels: Vec<Vec<f32>>,
}

/// The rates an AudioContext may have (Chrome's range): the rates decoding resamples to, and the rates a file may have
/// (Chrome refuses a file outside them too), which bounds the resampler's ratio.
const MIN_RATE: f32 = 3000.0;
const MAX_RATE: f32 = 768_000.0;

/// The most samples (frames times channels) one decode produces: 1 GiB of f32, 46 minutes of 48 kHz stereo. More is
/// an error, as is any allocation that fails (allocated fallibly: a failed allocation would abort the process, past
/// `catch_unwind`). Other allocations are bounded by the input's length, never by a header field.
pub(crate) const MAX_SAMPLES: usize = 1 << 28;

/// An empty vector with room for `n` samples, or an error where a failed allocation would abort.
pub(crate) fn sample_vec(n: usize) -> Result<Vec<f32>, String> {
    let mut v = Vec::new();
    v.try_reserve_exact(n).map_err(|_| format!("out of memory ({n} samples)"))?;
    Ok(v)
}

/// Decodes `bytes` (the whole file) and resamples to `target_rate`. The error is the message for the rejected
/// promise's EncodingError ("Unable to decode audio data" plus what failed).
pub fn decode(bytes: &[u8], target_rate: f32) -> Result<Decoded, String> {
    if !(MIN_RATE..=MAX_RATE).contains(&target_rate) {
        return Err(format!("Unable to decode audio data: sample rate {target_rate} is outside {MIN_RATE}..{MAX_RATE}"));
    }
    // A bug in a decoder must not take down the audio thread: a panic is reported as a failed decode.
    std::panic::catch_unwind(|| decode_inner(bytes, target_rate))
        .unwrap_or_else(|_| Err("decoder panicked".into()))
        .map_err(|e| format!("Unable to decode audio data: {e}"))
}

fn decode_inner(bytes: &[u8], target_rate: f32) -> Result<Decoded, String> {
    let (rate, channels) = if bytes.starts_with(b"OggS") {
        (opus::RATE, opus::decode(bytes)?)
    } else if wav::is_wav(bytes) {
        let w = wav::decode(bytes)?;
        (w.sample_rate, w.channels)
    } else if mp3::is_mp3(bytes) {
        mp3::decode(bytes)?
    } else if bytes.is_empty() {
        return Err("no data".into());
    } else {
        return Err("unsupported format (Ogg Opus, WAV and MP3 are decoded)".into());
    };
    // An AudioBuffer of zero frames cannot be made; Chrome rejects such a file too.
    if channels.first().is_none_or(Vec::is_empty) {
        return Err("no audio frames".into());
    }
    if !(MIN_RATE..=MAX_RATE).contains(&(rate as f32)) {
        return Err(format!("sample rate {rate} is outside {MIN_RATE}..{MAX_RATE}"));
    }
    let channels = if rate as f32 == target_rate { channels } else { resample::resample(&channels, rate, target_rate as f64)? };
    Ok(Decoded { sample_rate: target_rate, channels })
}
