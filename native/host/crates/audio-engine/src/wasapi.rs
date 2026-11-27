//! WASAPI output: shared mode on the default render endpoint, event-driven, through hand-written COM tables of methods
//! (windows-sys has no interfaces). The render thread runs at the "Pro Audio" MMCSS priority, fills what the endpoint
//! buffer has free each time the engine signals, and follows the default device: the device going away
//! (AUDCLNT_E_DEVICE_INVALIDATED) or the default endpoint changing (its id polled once a second on a watcher thread)
//! reopens on the new default, at the context's first rate (the engine converts when the new device runs at another).
//! An endpoint that takes nothing for a second without an error is reopened once, then left for the silent clock for
//! ten seconds. With no device the silent clock keeps time and a device is looked for each second.

use std::ffi::c_void;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::sync::mpsc::Sender;
use std::time::{Duration, Instant};

use windows_sys::Win32::Foundation::HANDLE;
use windows_sys::Win32::Media::Audio::AUDCLNT_E_DEVICE_INVALIDATED;
use windows_sys::Win32::System::Com::{CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize};
use windows_sys::Win32::System::Threading::{AvRevertMmThreadCharacteristics, AvSetMmThreadCharacteristicsW, WaitForSingleObject};
use windows_sys::core::GUID;

use crate::graph::{STATE_CLOSED, STATE_RUNNING, Shared};
use crate::output::{Pump, silent_clock};

const CLSID_MM_DEVICE_ENUMERATOR: GUID = GUID::from_u128(0xbcde0395_e52f_467c_8e3d_c4579291692e);
const IID_IMM_DEVICE_ENUMERATOR: GUID = GUID::from_u128(0xa95664d2_9614_4f35_a746_de8db63617e6);
const IID_IAUDIO_CLIENT: GUID = GUID::from_u128(0x1cb9ad4c_dbfa_4c32_b178_c2f568a703b2);
const IID_IAUDIO_RENDER_CLIENT: GUID = GUID::from_u128(0xf294acfc_3146_4483_a7bf_addca7c260e2);
const SUBTYPE_IEEE_FLOAT: GUID = GUID::from_u128(0x00000003_0000_0010_8000_00aa00389b71);

const E_RENDER: i32 = 0;
const E_CONSOLE: i32 = 0;
const AUDCLNT_SHAREMODE_SHARED: i32 = 0;
const AUDCLNT_STREAMFLAGS_EVENTCALLBACK: u32 = 0x0004_0000;
const AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM: u32 = 0x8000_0000;
const AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY: u32 = 0x0800_0000;
const AUDCLNT_BUFFERFLAGS_SILENT: u32 = 2;
const WAVE_FORMAT_IEEE_FLOAT: u16 = 3;
const WAVE_FORMAT_EXTENSIBLE: u16 = 0xfffe;
const SPEAKER_FRONT_LEFT_RIGHT: u32 = 0x3;

type This = *mut c_void;

/// IMMDeviceEnumerator's methods in order, up to the one used.
#[repr(C)]
struct EnumeratorVtbl {
    _query_interface: usize,
    _add_ref: usize,
    release: unsafe extern "system" fn(This) -> u32,
    _enum_audio_endpoints: usize,
    get_default_audio_endpoint: unsafe extern "system" fn(This, i32, i32, *mut This) -> i32,
}

/// IMMDevice's.
#[repr(C)]
struct DeviceVtbl {
    _query_interface: usize,
    _add_ref: usize,
    release: unsafe extern "system" fn(This) -> u32,
    activate: unsafe extern "system" fn(This, *const GUID, u32, *const c_void, *mut This) -> i32,
    _open_property_store: usize,
    get_id: unsafe extern "system" fn(This, *mut *mut u16) -> i32,
}

/// IAudioClient's.
#[repr(C)]
struct ClientVtbl {
    _query_interface: usize,
    _add_ref: usize,
    release: unsafe extern "system" fn(This) -> u32,
    initialize: unsafe extern "system" fn(This, i32, u32, i64, i64, *const WaveFormat, *const GUID) -> i32,
    get_buffer_size: unsafe extern "system" fn(This, *mut u32) -> i32,
    get_stream_latency: unsafe extern "system" fn(This, *mut i64) -> i32,
    get_current_padding: unsafe extern "system" fn(This, *mut u32) -> i32,
    _is_format_supported: usize,
    get_mix_format: unsafe extern "system" fn(This, *mut *mut WaveFormat) -> i32,
    _get_device_period: usize,
    start: unsafe extern "system" fn(This) -> i32,
    stop: unsafe extern "system" fn(This) -> i32,
    _reset: usize,
    set_event_handle: unsafe extern "system" fn(This, HANDLE) -> i32,
    get_service: unsafe extern "system" fn(This, *const GUID, *mut This) -> i32,
}

/// IAudioRenderClient's.
#[repr(C)]
struct RenderVtbl {
    _query_interface: usize,
    _add_ref: usize,
    release: unsafe extern "system" fn(This) -> u32,
    get_buffer: unsafe extern "system" fn(This, u32, *mut *mut u8) -> i32,
    release_buffer: unsafe extern "system" fn(This, u32, u32) -> i32,
}

/// WAVEFORMATEXTENSIBLE (WAVEFORMATEX's 18 bytes first; a plain WAVEFORMATEX has `cb_size` 0 and nothing after).
#[repr(C, packed(1))]
#[derive(Clone, Copy)]
struct WaveFormat {
    tag: u16,
    channels: u16,
    samples_per_sec: u32,
    avg_bytes_per_sec: u32,
    block_align: u16,
    bits_per_sample: u16,
    cb_size: u16,
    valid_bits: u16,
    channel_mask: u32,
    sub_format: GUID,
}

fn same_guid(a: &GUID, b: &GUID) -> bool {
    a.data1 == b.data1 && a.data2 == b.data2 && a.data3 == b.data3 && a.data4 == b.data4
}

/// A COM pointer released when dropped.
struct Com<V> {
    ptr: *mut *const V,
}

impl<V> Com<V> {
    fn vtbl(&self) -> &V {
        // SAFETY: a live COM object's first field is its table of methods.
        unsafe { &**self.ptr }
    }
    fn this(&self) -> This {
        self.ptr as This
    }
}

impl<V> Drop for Com<V> {
    fn drop(&mut self) {
        // SAFETY: every table here starts with IUnknown's three methods; release is the third.
        unsafe {
            let release = *((*self.ptr) as *const unsafe extern "system" fn(This) -> u32).add(2);
            release(self.this());
        }
    }
}

fn enumerator() -> Option<Com<EnumeratorVtbl>> {
    let mut object: This = std::ptr::null_mut();
    // SAFETY: COM is initialised on this thread (`run`).
    let hr = unsafe { CoCreateInstance(&CLSID_MM_DEVICE_ENUMERATOR, std::ptr::null_mut(), CLSCTX_ALL, &IID_IMM_DEVICE_ENUMERATOR, &mut object) };
    (hr >= 0 && !object.is_null()).then(|| Com { ptr: object as *mut *const EnumeratorVtbl })
}

fn default_device(enumerator: &Com<EnumeratorVtbl>) -> Option<Com<DeviceVtbl>> {
    let mut object: This = std::ptr::null_mut();
    // SAFETY: a method of a live enumerator, writing the device's pointer.
    let hr = unsafe { (enumerator.vtbl().get_default_audio_endpoint)(enumerator.this(), E_RENDER, E_CONSOLE, &mut object) };
    (hr >= 0 && !object.is_null()).then(|| Com { ptr: object as *mut *const DeviceVtbl })
}

fn device_id(device: &Com<DeviceVtbl>) -> Vec<u16> {
    let mut id: *mut u16 = std::ptr::null_mut();
    // SAFETY: GetId hands back a string from CoTaskMemAlloc, read up to its NUL and freed.
    unsafe {
        if (device.vtbl().get_id)(device.this(), &mut id) < 0 || id.is_null() {
            return Vec::new();
        }
        let mut n = 0;
        while *id.add(n) != 0 {
            n += 1;
        }
        let out = std::slice::from_raw_parts(id, n).to_vec();
        CoTaskMemFree(id as *const c_void);
        out
    }
}

/// The default endpoint's id now (empty when there is none).
fn default_id(enumerator: &Com<EnumeratorVtbl>) -> Vec<u16> {
    default_device(enumerator).map(|d| device_id(&d)).unwrap_or_default()
}

/// Watches the default output device on its own thread (a cross-process COM call each second has no place on the
/// render thread), bumping `Shared::device_epoch` when it changes. Ends when the context closes or the render thread
/// is gone.
fn watch_default_device(shared: Arc<Shared>) {
    let _ = std::thread::Builder::new().name("audio-device-watch".into()).spawn(move || {
        // SAFETY: COM for this thread, undone before it ends.
        let com = unsafe { CoInitializeEx(std::ptr::null(), COINIT_MULTITHREADED as u32) >= 0 };
        if let Some(enumerator) = enumerator() {
            let mut last = default_id(&enumerator);
            'watch: loop {
                for _ in 0..10 {
                    std::thread::sleep(Duration::from_millis(100));
                    if shared.state.load(Ordering::Acquire) == STATE_CLOSED || shared.render_gone.load(Ordering::Acquire) {
                        break 'watch;
                    }
                }
                let id = default_id(&enumerator);
                if id != last {
                    last = id;
                    shared.device_epoch.fetch_add(1, Ordering::AcqRel);
                }
            }
        }
        if com {
            // SAFETY: balancing this thread's CoInitializeEx.
            unsafe { CoUninitialize() };
        }
    });
}

/// An open, started stream on the default endpoint. The render client is released before the audio client (field
/// order), and the event it signals belongs to `Shared`.
struct Stream {
    render: Com<RenderVtbl>,
    client: Com<ClientVtbl>,
    event: HANDLE,
    /// `Shared::device_epoch` when it was opened: a later one means the default device changed.
    epoch: u64,
    sample_rate: u32,
    channels: usize,
    buffer_frames: u32,
    latency: f64,
}

impl Drop for Stream {
    fn drop(&mut self) {
        // SAFETY: the stream's own client.
        unsafe {
            (self.client.vtbl().stop)(self.client.this());
        }
    }
}

/// Why a stream stopped.
enum Exit {
    Closed,
    /// The device went away, failed, or stopped being the default.
    Reopen,
    /// The endpoint took nothing for a second without an error.
    Stalled,
}

/// With no buffer filled for this long the stream is given up as stuck.
const STALL: Duration = Duration::from_secs(1);

impl Stream {
    /// Opens the default endpoint: its mix format as it is when that is float at `rate` (or any rate when None), else
    /// f32 stereo at `rate` (or the mix rate) with the engine converting.
    fn open(enumerator: &Com<EnumeratorVtbl>, shared: &Shared, rate: Option<u32>) -> Option<Stream> {
        let event = shared.wake as HANDLE;
        if event.is_null() {
            return None;
        }
        let epoch = shared.device_epoch.load(Ordering::Acquire);
        let device = default_device(enumerator)?;
        let mut object: This = std::ptr::null_mut();
        // SAFETY: COM calls on live objects, as documented for a shared-mode event-driven stream; the mix format is
        // read (unaligned, it is packed) only as far as its tag and size say it goes, and freed with CoTaskMemFree.
        unsafe {
            if (device.vtbl().activate)(device.this(), &IID_IAUDIO_CLIENT, CLSCTX_ALL, std::ptr::null(), &mut object) < 0 || object.is_null() {
                return None;
            }
            let client = Com { ptr: object as *mut *const ClientVtbl };
            let mut mix: *mut WaveFormat = std::ptr::null_mut();
            if (client.vtbl().get_mix_format)(client.this(), &mut mix) < 0 || mix.is_null() {
                return None;
            }
            let head = std::ptr::read_unaligned(mix as *const [u8; 18]);
            let tag = u16::from_le_bytes([head[0], head[1]]);
            let mix_rate = u32::from_le_bytes([head[4], head[5], head[6], head[7]]);
            let bits = u16::from_le_bytes([head[14], head[15]]);
            let cb_size = u16::from_le_bytes([head[16], head[17]]);
            // WAVEFORMATEXTENSIBLE's 22 bytes past WAVEFORMATEX exist only when the tag and cbSize say so.
            let extensible_float = tag == WAVE_FORMAT_EXTENSIBLE && cb_size >= 22 && {
                let extended = std::ptr::read_unaligned(mix);
                same_guid(&{ extended.sub_format }, &SUBTYPE_IEEE_FLOAT)
            };
            let float = bits == 32 && (tag == WAVE_FORMAT_IEEE_FLOAT || extensible_float);
            let use_mix = float && rate.is_none_or(|r| r == mix_rate);
            let rate = rate.unwrap_or(mix_rate);
            let own = WaveFormat {
                tag: WAVE_FORMAT_EXTENSIBLE,
                channels: 2,
                samples_per_sec: rate,
                avg_bytes_per_sec: rate * 8,
                block_align: 8,
                bits_per_sample: 32,
                cb_size: 22,
                valid_bits: 32,
                channel_mask: SPEAKER_FRONT_LEFT_RIGHT,
                sub_format: SUBTYPE_IEEE_FLOAT,
            };
            let (format, flags) = if use_mix {
                (mix as *const WaveFormat, AUDCLNT_STREAMFLAGS_EVENTCALLBACK)
            } else {
                (
                    &own as *const WaveFormat,
                    AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
                )
            };
            let channels = if use_mix { u16::from_le_bytes([head[2], head[3]]) as usize } else { 2 };
            let hr = (client.vtbl().initialize)(client.this(), AUDCLNT_SHAREMODE_SHARED, flags, 0, 0, format, std::ptr::null());
            CoTaskMemFree(mix as *const c_void);
            if hr < 0 {
                return None;
            }
            if (client.vtbl().set_event_handle)(client.this(), event) < 0 {
                return None;
            }
            let mut buffer_frames = 0u32;
            if (client.vtbl().get_buffer_size)(client.this(), &mut buffer_frames) < 0 || buffer_frames == 0 {
                return None;
            }
            let mut render: This = std::ptr::null_mut();
            if (client.vtbl().get_service)(client.this(), &IID_IAUDIO_RENDER_CLIENT, &mut render) < 0 || render.is_null() {
                return None;
            }
            let render = Com { ptr: render as *mut *const RenderVtbl };
            let mut stream_latency = 0i64;
            (client.vtbl().get_stream_latency)(client.this(), &mut stream_latency);
            // What is queued ahead of the speaker once the buffer is full, plus the engine's own latency.
            let latency = buffer_frames as f64 / rate as f64 + stream_latency as f64 * 1e-7;
            // Start on a buffer of silence, so the first period is not a glitch.
            let mut data: *mut u8 = std::ptr::null_mut();
            if (render.vtbl().get_buffer)(render.this(), buffer_frames, &mut data) >= 0 {
                (render.vtbl().release_buffer)(render.this(), buffer_frames, AUDCLNT_BUFFERFLAGS_SILENT);
            }
            if (client.vtbl().start)(client.this()) < 0 {
                return None;
            }
            Some(Stream { render, client, event, epoch, sample_rate: rate, channels: channels.max(1), buffer_frames, latency })
        }
    }

    /// Feeds the endpoint until the context closes, the device goes away or stops being the default, or the endpoint
    /// stops taking audio.
    fn run(&self, shared: &Shared, pump: &mut Pump) -> Exit {
        let mut last_fill = Instant::now();
        loop {
            // SAFETY: waiting on the stream's event, and its client's and render client's methods with buffers the
            // engine handed out (`available` frames of `channels` f32 each).
            unsafe {
                WaitForSingleObject(self.event, 200);
                if shared.state.load(Ordering::Acquire) == STATE_CLOSED {
                    return Exit::Closed;
                }
                if shared.device_epoch.load(Ordering::Acquire) != self.epoch {
                    return Exit::Reopen;
                }
                if last_fill.elapsed() > STALL {
                    return Exit::Stalled;
                }
                let mut padding = 0u32;
                let hr = (self.client.vtbl().get_current_padding)(self.client.this(), &mut padding);
                if hr == AUDCLNT_E_DEVICE_INVALIDATED || hr < 0 {
                    return Exit::Reopen;
                }
                let available = self.buffer_frames.saturating_sub(padding);
                if available == 0 {
                    continue;
                }
                let mut data: *mut u8 = std::ptr::null_mut();
                let hr = (self.render.vtbl().get_buffer)(self.render.this(), available, &mut data);
                if hr < 0 || data.is_null() {
                    return Exit::Reopen;
                }
                if shared.state.load(Ordering::Acquire) != STATE_RUNNING {
                    pump.idle(shared);
                    (self.render.vtbl().release_buffer)(self.render.this(), available, AUDCLNT_BUFFERFLAGS_SILENT);
                    last_fill = Instant::now();
                    continue;
                }
                let out = std::slice::from_raw_parts_mut(data as *mut f32, available as usize * self.channels);
                match self.channels {
                    1 => {
                        for frame in out.iter_mut() {
                            let (l, r) = pump.next(shared);
                            *frame = 0.5 * (l + r);
                        }
                    }
                    2 => {
                        for frame in out.as_chunks_mut::<2>().0 {
                            let (l, r) = pump.next(shared);
                            frame[0] = l;
                            frame[1] = r;
                        }
                    }
                    n => {
                        // More speakers than two: the graph's left and right on the front pair, the rest silent.
                        for frame in out.chunks_exact_mut(n) {
                            let (l, r) = pump.next(shared);
                            frame[0] = l;
                            frame[1] = r;
                            frame[2..].fill(0.0);
                        }
                    }
                }
                let hr = (self.render.vtbl().release_buffer)(self.render.this(), available, 0);
                if hr < 0 {
                    return Exit::Reopen;
                }
                last_fill = Instant::now();
                shared.device_frames.fetch_add(available as u64, Ordering::Relaxed);
                shared.device_periods.fetch_add(1, Ordering::Relaxed);
            }
        }
    }
}

/// The render thread's body: COM, MMCSS, the stream (or the silent clock), reopened as the device changes.
pub fn run(shared: Arc<Shared>, ready: Sender<f32>) {
    // SAFETY: COM for this thread (multithreaded: the objects never leave it), and MMCSS for this thread, reverted
    // before it ends.
    let (com, mmcss) = unsafe {
        let com = CoInitializeEx(std::ptr::null(), COINIT_MULTITHREADED as u32) >= 0;
        let mut task = 0u32;
        let name: Vec<u16> = "Pro Audio\0".encode_utf16().collect();
        let mut mmcss = AvSetMmThreadCharacteristicsW(name.as_ptr(), &mut task);
        if mmcss.is_null() {
            let name: Vec<u16> = "Games\0".encode_utf16().collect();
            mmcss = AvSetMmThreadCharacteristicsW(name.as_ptr(), &mut task);
        }
        (com, mmcss)
    };
    let enumerator = enumerator();
    let mut stream = enumerator.as_ref().and_then(|e| Stream::open(e, &shared, None));
    let sample_rate = stream.as_ref().map_or(48000, |s| s.sample_rate);
    let rate = sample_rate as f32;
    shared.sample_rate.store(rate.to_bits(), Ordering::Release);
    let mut pump = Pump::new(rate);
    if let Some(s) = &stream {
        shared.latency.store(s.latency.to_bits(), Ordering::Release);
    }
    let _ = ready.send(rate);
    watch_default_device(shared.clone());
    // After a stall, the device is not tried again until this time (the silent clock keeps time meanwhile).
    let mut retry_at = Instant::now();
    let mut stalls = 0u32;
    loop {
        match (&stream, &enumerator) {
            (Some(s), Some(e)) => match s.run(&shared, &mut pump) {
                Exit::Closed => break,
                Exit::Reopen => {
                    // The old stream closes before the new default opens.
                    drop(stream.take());
                    stream = Stream::open(e, &shared, Some(sample_rate));
                }
                Exit::Stalled => {
                    drop(stream.take());
                    stalls += 1;
                    if stalls == 1 {
                        // Once: straight back on a new stream.
                        stream = Stream::open(e, &shared, Some(sample_rate));
                    } else {
                        // Again: the silent clock for a while, then another try.
                        stalls = 0;
                        retry_at = Instant::now() + Duration::from_secs(10);
                    }
                }
            },
            _ => {
                // No device: keep time silently, looking for one each second.
                shared.latency.store(0f64.to_bits(), Ordering::Release);
                let closed = silent_clock(&shared, &mut pump, || {
                    if let Some(e) = &enumerator
                        && Instant::now() >= retry_at
                    {
                        stream = Stream::open(e, &shared, Some(sample_rate));
                    }
                    stream.is_some()
                });
                if closed {
                    break;
                }
            }
        }
        if let Some(s) = &stream {
            shared.latency.store(s.latency.to_bits(), Ordering::Release);
        }
    }
    drop(stream);
    drop(enumerator);
    // SAFETY: undoing this thread's MMCSS and COM initialisation.
    unsafe {
        if !mmcss.is_null() {
            AvRevertMmThreadCharacteristics(mmcss);
        }
        if com {
            CoUninitialize();
        }
    }
}
