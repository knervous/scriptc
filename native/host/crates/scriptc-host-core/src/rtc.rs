//! WebRTC data channels: `RTCPeerConnection` and `RTCDataChannel`, the part of the W3C API a page uses for
//! peer-to-peer data (no media), on webrtc-rs (the `webrtc` crate's async layer over its Sans-I/O core) running on the
//! network layer's Tokio runtime (net.rs `runtime`).
//!
//! The page side lives on the thread that made the objects: their attributes (the four states, the descriptions, a
//! channel's `readyState` and `bufferedAmount`) are read there without a round trip, and every change arrives as a task
//! of that thread's loop (abi.rs io_poll), the attribute updated just before its event fires, as a browser queues them:
//! the engine posts to the thread's queue and rings its doorbell (channels.rs, as a BroadcastChannel post from another
//! thread does). Each connection's operations run in order on a task of its own (the spec's operations chain); a
//! method's promise settles as a task, its state change (signalingstatechange) fired first.
//!
//! - `new RTCPeerConnection({ iceServers, iceTransportPolicy })`: STUN and TURN servers (`urls` a string or a list;
//!   `username`, `credential`); `iceTransportPolicy: "relay"` gathers TURN relays only. TURN is used over UDP; `turns:`
//!   and TCP TURN URLs are skipped by the engine. The engine binds the machine's IPv4 interfaces (one socket each, an
//!   ephemeral port). Candidate privacy as a browser has it: what the page is given (`localDescription`,
//!   `icecandidate`, so what an invite carries) names the primary interface's host candidate only by an mDNS name
//!   (`<uuid>.local`, answered on 5353), lists no other host address, and hides a reflexive or relay candidate's base
//!   (`raddr 0.0.0.0 rport 0`); a peer's mDNS candidates are resolved. Without port 5353, the connection is made with
//!   mDNS off: no host candidate is given out and a peer's `.local` ones are dropped (reflexive candidates serve).
//! - `createOffer()`, `createAnswer()` resolve `{ type, sdp }`; `setLocalDescription(description?)`,
//!   `setRemoteDescription(description)`; `localDescription` (with the candidates gathered so far, as a browser's
//!   pending description has them), `remoteDescription`; `signalingState`, `iceGatheringState`,
//!   `iceConnectionState`, `connectionState` and their change events; `icecandidate` (a `null` candidate once
//!   gathering completes); `datachannel` (`event.channel`); `createDataChannel(label, { ordered, maxRetransmits,
//!   maxPacketLifeTime, protocol, negotiated, id })`; `close()` (states to "closed" with no events, as the spec has it).
//! - `RTCDataChannel`: `label`, `ordered`, `maxRetransmits`, `maxPacketLifeTime`, `protocol`, `negotiated`, `id`,
//!   `readyState`, `binaryType`, `bufferedAmount` (bytes sent and not yet released by SCTP), `bufferedAmountLowThreshold`;
//!   `send(string | ArrayBuffer | typed array)`, `close()`; `open`, `message` (binary data as an ArrayBuffer whatever
//!   `binaryType` says; text as a string), `bufferedamountlow`, `error`, `closing`, `close`.
//! - Events reach `addEventListener` listeners (the `on<type>` handler first) as `{ type, target, ... }`.
//!
//! Not carried: media (tracks, transceivers), `addIceCandidate` (trickle ICE), `getStats`, `restartIce`,
//! `setConfiguration`, certificates, `bundlePolicy` and `iceTransportPolicy`; Blob messages.
//!
//! SCRIPTC_HOST_TRACE_RTC=1: each connection's operations, state changes and channel events on stderr, with times; the
//! remote candidates it was given, and the candidate pair ICE chose (with its checks each way) when it connects.

use std::cell::RefCell;
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender, unbounded_channel};
use webrtc::data_channel::{DataChannel, DataChannelEvent, RTCDataChannelInit};
use webrtc::peer_connection::{
    PeerConnection, PeerConnectionBuilder, PeerConnectionEventHandler, RTCConfigurationBuilder, RTCIceConnectionState,
    RTCIceGatheringState, RTCIceTransportPolicy, RTCIceServer, RTCPeerConnectionIceEvent, RTCPeerConnectionState, RTCSdpType,
    RTCSessionDescription, SettingEngineBuilder,
};

use crate::channels::Doorbell;
use crate::objects::{self, Value};
use crate::values;

// ── the engine's side ──────────────────────────────────────────────────

/// A connection's operations, in the order the page called them, and what its event handler heard.
enum Cmd {
    CreateOffer(u64),
    CreateAnswer(u64),
    /// The promise, and the description (None: the implicit one, of the type the signaling state calls for).
    SetLocal(u64, Option<Description>, RTCSdpType),
    SetRemote(u64, Description),
    Channel { dc: u32, label: String, init: RTCDataChannelInit, rx: UnboundedReceiver<DcCmd> },
    Close,
    Heard(Heard),
}

/// What a connection's event handler heard (forwarded to its task, which posts it in order).
enum Heard {
    Gathering(RTCIceGatheringState),
    Ice(RTCIceConnectionState),
    Connection(RTCPeerConnectionState),
    Candidate(Candidate),
    Channel(Arc<dyn DataChannel>),
}

/// A channel's sends and its close, in order.
enum DcCmd {
    Send(Vec<u8>, bool),
    Close,
}

#[derive(Clone, Debug)]
struct Description {
    kind: String,
    sdp: String,
}

#[derive(Clone, Debug)]
struct Candidate {
    candidate: String,
    sdp_mid: Option<String>,
    sdp_mline_index: Option<u16>,
}

#[derive(Clone, Debug)]
struct ChannelInfo {
    label: String,
    protocol: String,
    ordered: bool,
    max_retransmits: Option<u16>,
    max_packet_life_time: Option<u16>,
    negotiated: bool,
}

enum Settled {
    Description(Description),
    /// A description applied: the local one as it now reads (with its candidates), for a local apply.
    Applied { local: bool, applied: Description, current: Option<Description> },
}

/// What the engine tells the page thread.
enum Out {
    Settle { pc: u32, promise: u64, result: Result<Settled, (String, String)> },
    State { pc: u32, which: Which, value: String },
    LocalDescription { pc: u32, description: Description },
    IceCandidate { pc: u32, candidate: Option<Candidate> },
    /// A channel the peer opened, with the sender for its sends.
    Announced { pc: u32, dc: u32, info: ChannelInfo, tx: UnboundedSender<DcCmd> },
    ChannelState { dc: u32, event: ChannelEvent },
    Message { dc: u32, data: Vec<u8>, text: bool },
    /// Sends handed to SCTP (`sent` bytes), and what SCTP still holds.
    Drained { dc: u32, sent: usize, outstanding: usize },
    /// The connection could not be made at all (its sockets): it fails.
    Failed { pc: u32, message: String },
}

#[derive(Clone, Copy, Debug)]
enum Which {
    Gathering,
    Ice,
    Connection,
}

#[derive(Clone, Copy, Debug)]
enum ChannelEvent {
    Open,
    Closing,
    Close,
    Error,
}

/// A thread's queue of what the engine posted, and its doorbell.
#[derive(Clone)]
struct Sink {
    queue: Arc<Mutex<VecDeque<Out>>>,
    doorbell: Doorbell,
}

impl Sink {
    fn post(&self, out: Out) {
        self.queue.lock().unwrap_or_else(|e| e.into_inner()).push_back(out);
        self.doorbell.ring();
    }
}

static NEXT_PEER: AtomicU32 = AtomicU32::new(1);
static NEXT_CHANNEL: AtomicU32 = AtomicU32::new(1);

fn trace_on() -> bool {
    static ON: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *ON.get_or_init(|| std::env::var_os("SCRIPTC_HOST_TRACE_RTC").is_some())
}

fn trace(what: &str) {
    if trace_on() {
        // One clock for every thread (the engine's included): seconds since the first trace.
        static START: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();
        eprintln!("[{:.3}] rtc: {what}", START.get_or_init(std::time::Instant::now).elapsed().as_secs_f64());
    }
}

/// The handler webrtc-rs calls (on its driver): everything goes to the connection's task, never back into the driver.
struct Forward(UnboundedSender<Cmd>);

#[async_trait::async_trait]
impl PeerConnectionEventHandler for Forward {
    async fn on_ice_candidate(&self, event: RTCPeerConnectionIceEvent) {
        if let Ok(init) = event.candidate.to_json() {
            let _ = self.0.send(Cmd::Heard(Heard::Candidate(Candidate {
                candidate: init.candidate,
                sdp_mid: init.sdp_mid,
                sdp_mline_index: init.sdp_mline_index,
            })));
        }
    }

    async fn on_ice_connection_state_change(&self, state: RTCIceConnectionState) {
        let _ = self.0.send(Cmd::Heard(Heard::Ice(state)));
    }

    async fn on_ice_gathering_state_change(&self, state: RTCIceGatheringState) {
        let _ = self.0.send(Cmd::Heard(Heard::Gathering(state)));
    }

    async fn on_connection_state_change(&self, state: RTCPeerConnectionState) {
        let _ = self.0.send(Cmd::Heard(Heard::Connection(state)));
    }

    async fn on_data_channel(&self, data_channel: Arc<dyn DataChannel>) {
        let _ = self.0.send(Cmd::Heard(Heard::Channel(data_channel)));
    }
}

/// A state's W3C name ("" for the engine's unspecified value, which is never posted).
fn state_name(state: &impl std::fmt::Display) -> String {
    let s = state.to_string();
    if s.eq_ignore_ascii_case("unspecified") { String::new() } else { s }
}

fn description_of(d: &RTCSessionDescription) -> Description {
    Description { kind: d.sdp_type.to_string(), sdp: private_sdp(&d.sdp) }
}

/// A local candidate as the page (and so the peer) is given it, as a browser's mDNS candidate privacy hands it out:
/// a host candidate only under its mDNS name (`<uuid>.local`), never an address; a reflexive or relay candidate with
/// its base hidden (`raddr 0.0.0.0 rport 0`); component 1 only (data channels multiplex RTCP). None: not given out.
/// The engine still uses every address it gathered, and a peer on the same network reaches the host candidate
/// through its name, or as a peer-reflexive one.
fn private_candidate(line: &str) -> Option<String> {
    let (prefix, attribute) = match line.strip_prefix("a=") {
        Some(rest) => ("a=", rest),
        None => ("", line),
    };
    let fields: Vec<&str> = attribute.split(' ').collect();
    // candidate:<foundation> <component> <transport> <priority> <address> <port> typ <type> [raddr <a> rport <p>] ...
    if fields.len() < 8 || !fields[0].starts_with("candidate:") || fields[6] != "typ" {
        return Some(line.to_string());
    }
    if fields[1] != "1" {
        return None;
    }
    if fields[7] == "host" && !fields[4].ends_with(".local") {
        return None;
    }
    let mut out: Vec<String> = fields.iter().map(|f| f.to_string()).collect();
    for i in 8..out.len().saturating_sub(1) {
        match out[i].as_str() {
            "raddr" => out[i + 1] = "0.0.0.0".into(),
            "rport" => out[i + 1] = "0".into(),
            _ => {}
        }
    }
    Some(format!("{prefix}{}", out.join(" ")))
}

/// A local description with its candidates made private ([`private_candidate`]).
fn private_sdp(sdp: &str) -> String {
    let mut out = String::with_capacity(sdp.len());
    for line in sdp.split_inclusive('\n') {
        let body = line.trim_end_matches(['\r', '\n']);
        if body.starts_with("a=candidate:") {
            if let Some(kept) = private_candidate(body) {
                out.push_str(&kept);
                out.push_str("\r\n");
            }
        } else {
            out.push_str(line);
        }
    }
    out
}

/// The IPv4 address of the interface the default route leaves by (no packet is sent): the one a host candidate is
/// named for over mDNS, as a browser names its own.
fn primary_ipv4() -> Option<std::net::IpAddr> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("192.0.2.1:9").ok()?;
    Some(socket.local_addr().ok()?.ip()).filter(|ip| !ip.is_unspecified() && !ip.is_loopback())
}

fn engine_description(d: &Description, implicit_kind: RTCSdpType) -> Result<RTCSessionDescription, (String, String)> {
    let parsed = match d.kind.as_str() {
        _ if d.sdp.is_empty() => {
            // The implicit description: the engine reuses the last one it generated of that type.
            let mut empty = RTCSessionDescription::default();
            empty.sdp_type = implicit_kind;
            return Ok(empty);
        }
        "offer" => RTCSessionDescription::offer(d.sdp.clone()),
        "answer" => RTCSessionDescription::answer(d.sdp.clone()),
        other => return Err(("NotSupportedError".into(), format!("a description of type '{other}' is not supported"))),
    };
    parsed.map_err(|e| ("InvalidAccessError".into(), format!("the session description cannot be parsed: {e}")))
}

fn failure(e: impl std::fmt::Display) -> (String, String) {
    ("OperationError".into(), e.to_string())
}

/// Connectivity checks per candidate pair before it is given up (200 ms apart: 20 s, longer than a guest waits).
const ICE_CHECKS_PER_PAIR: u16 = 100;

/// The longest a TURN allocation goes without a Refresh (it also keeps the NAT mapping toward the server alive).
const TURN_REFRESH_INTERVAL: Duration = Duration::from_secs(25);

/// One connection, built on the network runtime: its sockets first (a wildcard bind, one socket per IPv4 interface),
/// then each command in order.
async fn run_peer(pc: u32, config: Config, mut rx: UnboundedReceiver<Cmd>, tx: UnboundedSender<Cmd>, sink: Sink) {
    let Config { servers, relay_only } = config;
    let primary = primary_ipv4();
    let build = |mdns: bool| {
        use rtc::ice::mdns::MulticastDnsMode;
        let settings = match (mdns, primary) {
            // The primary interface's host candidate is gathered under an mDNS name; a peer's names are resolved.
            (true, Some(ip)) => SettingEngineBuilder::new().with_multicast_dns_mode(MulticastDnsMode::QueryAndGather).with_multicast_dns_local_ip(Some(ip)),
            (true, None) => SettingEngineBuilder::new().with_multicast_dns_mode(MulticastDnsMode::QueryOnly),
            (false, _) => SettingEngineBuilder::new().with_multicast_dns_mode(MulticastDnsMode::Disabled),
        };
        // Nominate as a browser does, without the ICE agent's own holds before a working pair may be chosen (0 for a
        // host pair, 0.5 s reflexive, 1 s peer-reflexive, 2 s relay): a guest gives the host a few seconds from its
        // answer to open the channels, and between two machines, where the pair that works is often a
        // relay or a peer-reflexive one, the 2 s hold plus DTLS over the relay went past it. Every pair is checked
        // on the first tick, so a direct pair on the same network still succeeds, and wins, before the relay's
        // 300 ms are up.
        let settings = settings
            .with_host_acceptance_min_wait(Some(Duration::ZERO))
            .with_srflx_acceptance_min_wait(Some(Duration::ZERO))
            .with_prflx_acceptance_min_wait(Some(Duration::ZERO))
            .with_relay_acceptance_min_wait(Some(Duration::from_millis(300)))
            // Keep checking every pair as a browser does, not for 1.6 s: the ICE agent marks a pair failed after 8
            // unanswered checks (200 ms apart) and, controlling, never checks it again, even when the peer's own
            // checks then arrive on it (it answers them, but RFC 8445's triggered check is missing). So when the
            // guest's side of a path opens after the host's first checks (its NAT mapping or TURN permission toward
            // this machine comes late), the guest sees ICE connected while the host never nominates: no DTLS, and
            // the guest's "The host did not complete the connection." Reproduced with a Chrome guest that learns the
            // host's candidates 3 s after its answer: stuck before; connected 0.57 s after the path opened with this.
            .with_ice_connection_attempts(None, Some(ICE_CHECKS_PER_PAIR))
            // Refresh the TURN allocations often enough to keep this machine's NAT mapping toward the TURN server
            // (and, on an endpoint-independent NAT, the reflexive address an offer names) alive while an offer waits
            // for its answer. By default the refresh comes at half the 600 s lifetime, and a router that drops an
            // idle UDP mapping sooner (30 s to 2 min is common) can hand the next packet a new port: the server then
            // no longer knows the allocation (437) and the relay the offer names is dead.
            .with_turn_allocation_refresh_interval_cap(TURN_REFRESH_INTERVAL);
        let policy = if relay_only { RTCIceTransportPolicy::Relay } else { RTCIceTransportPolicy::All };
        PeerConnectionBuilder::<String>::new()
            .with_configuration(RTCConfigurationBuilder::new().with_ice_servers(servers.clone()).with_ice_transport_policy(policy).build())
            .with_setting_engine(settings.build())
            .with_handler(Arc::new(Forward(tx.clone())))
            .with_udp_addrs(vec!["0.0.0.0:0".to_string()])
            .build()
    };
    let connection: Arc<dyn PeerConnection> = match build(true).await {
        Ok(c) => Arc::new(c),
        Err(first) => {
            // mDNS needs port 5353; without it, a peer's .local candidates are dropped and its others serve.
            trace(&format!("pc{pc}: built without mDNS ({first})"));
            match build(false).await {
                Ok(c) => Arc::new(c),
                Err(e) => {
                    trace(&format!("pc{pc}: could not be built: {e}"));
                    sink.post(Out::Failed { pc, message: e.to_string() });
                    // Every operation queued or to come fails.
                    while let Some(cmd) = rx.recv().await {
                        match cmd {
                            Cmd::CreateOffer(p) | Cmd::CreateAnswer(p) | Cmd::SetLocal(p, ..) | Cmd::SetRemote(p, _) => {
                                sink.post(Out::Settle { pc, promise: p, result: Err(failure(&e)) });
                            }
                            Cmd::Channel { dc, .. } => sink.post(Out::ChannelState { dc, event: ChannelEvent::Close }),
                            Cmd::Close => return,
                            Cmd::Heard(_) => {}
                        }
                    }
                    return;
                }
            }
        }
    };
    drop(tx);
    trace(&format!("pc{pc}: built"));
    let mut channels: Vec<Arc<dyn DataChannel>> = Vec::new();
    // ICE has connected once (the trace names the pair it chose).
    let mut connected = false;
    while let Some(cmd) = rx.recv().await {
        match cmd {
            Cmd::CreateOffer(promise) => {
                let result = connection.create_offer(None).await.map(|d| Settled::Description(description_of(&d))).map_err(failure);
                sink.post(Out::Settle { pc, promise, result });
            }
            Cmd::CreateAnswer(promise) => {
                let result = connection.create_answer(None).await.map(|d| Settled::Description(description_of(&d))).map_err(failure);
                sink.post(Out::Settle { pc, promise, result });
            }
            Cmd::SetLocal(promise, description, implicit_kind) => {
                let description = description.unwrap_or(Description { kind: implicit_kind.to_string(), sdp: String::new() });
                let result = match engine_description(&description, implicit_kind) {
                    Ok(d) => {
                        let kind = d.sdp_type.to_string();
                        match connection.set_local_description(d).await {
                            Ok(()) => {
                                let current = connection.local_description().await.map(|d| description_of(&d));
                                Ok(Settled::Applied { local: true, applied: Description { kind, sdp: description.sdp }, current })
                            }
                            Err(e) => Err(failure(e)),
                        }
                    }
                    Err(e) => Err(e),
                };
                trace(&format!("pc{pc}: setLocalDescription {}", if result.is_ok() { "applied" } else { "failed" }));
                sink.post(Out::Settle { pc, promise, result });
            }
            Cmd::SetRemote(promise, description) => {
                let remote_candidates: Vec<String> = if trace_on() {
                    description.sdp.lines().filter(|l| l.starts_with("a=candidate:")).map(String::from).collect()
                } else {
                    Vec::new()
                };
                let result = match engine_description(&description, RTCSdpType::Offer) {
                    Ok(d) => match connection.set_remote_description(d).await {
                        Ok(()) => Ok(Settled::Applied { local: false, applied: description, current: None }),
                        Err(e) => Err(failure(e)),
                    },
                    Err(e) => Err(e),
                };
                if let Err((_, message)) = &result {
                    trace(&format!("pc{pc}: setRemoteDescription failed: {message}"));
                } else {
                    trace(&format!("pc{pc}: setRemoteDescription applied"));
                    if trace_on() {
                        for line in &remote_candidates {
                            trace(&format!("pc{pc}:   remote {line}"));
                        }
                    }
                }
                sink.post(Out::Settle { pc, promise, result });
            }
            Cmd::Channel { dc, label, init, rx } => match connection.create_data_channel(&label, Some(init)).await {
                Ok(channel) => {
                    channels.push(channel.clone());
                    start_channel(dc, channel, rx, sink.clone());
                }
                Err(e) => {
                    trace(&format!("pc{pc}: channel '{label}' could not be made: {e}"));
                    sink.post(Out::ChannelState { dc, event: ChannelEvent::Error });
                    sink.post(Out::ChannelState { dc, event: ChannelEvent::Close });
                }
            },
            Cmd::Close => {
                for c in &channels {
                    let _ = c.close().await;
                }
                let _ = connection.close().await;
                trace(&format!("pc{pc}: closed"));
                return;
            }
            Cmd::Heard(Heard::Gathering(state)) => {
                if state == RTCIceGatheringState::Complete {
                    // The description a gathering-complete listener reads carries every candidate.
                    if let Some(d) = connection.local_description().await {
                        sink.post(Out::LocalDescription { pc, description: description_of(&d) });
                    }
                    sink.post(Out::IceCandidate { pc, candidate: None });
                }
                post_state(&sink, pc, Which::Gathering, state_name(&state));
            }
            Cmd::Heard(Heard::Ice(state)) => {
                if state == RTCIceConnectionState::Connected && !std::mem::replace(&mut connected, true) && trace_on() {
                    trace_pairs(pc, &connection).await;
                }
                post_state(&sink, pc, Which::Ice, state_name(&state));
            }
            Cmd::Heard(Heard::Connection(state)) => post_state(&sink, pc, Which::Connection, state_name(&state)),
            Cmd::Heard(Heard::Candidate(candidate)) => {
                if let Some(d) = connection.local_description().await {
                    sink.post(Out::LocalDescription { pc, description: description_of(&d) });
                }
                // A candidate the page is not given (a host address) fires no event either.
                if let Some(text) = private_candidate(&candidate.candidate) {
                    sink.post(Out::IceCandidate { pc, candidate: Some(Candidate { candidate: text, ..candidate }) });
                }
            }
            Cmd::Heard(Heard::Channel(channel)) => {
                let dc = NEXT_CHANNEL.fetch_add(1, Ordering::Relaxed);
                let info = ChannelInfo {
                    label: channel.label().await.unwrap_or_default(),
                    protocol: channel.protocol().await.unwrap_or_default(),
                    ordered: channel.ordered().await.unwrap_or(true),
                    max_retransmits: channel.max_retransmits().await.ok().flatten(),
                    max_packet_life_time: channel.max_packet_life_time().await.ok().flatten(),
                    negotiated: channel.negotiated().await.unwrap_or(false),
                };
                trace(&format!("pc{pc}: the peer opened channel '{}' (dc{dc})", info.label));
                let (dc_tx, dc_rx) = unbounded_channel();
                sink.post(Out::Announced { pc, dc, info, tx: dc_tx });
                channels.push(channel.clone());
                start_channel(dc, channel, dc_rx, sink.clone());
            }
        }
    }
}

/// The trace's view of the path ICE chose (SCRIPTC_HOST_TRACE_RTC): the candidate pair, its state and the checks each
/// way. (webrtc-rs reports pair statistics for the selected pair only, so there is nothing to say before one.)
async fn trace_pairs(pc: u32, connection: &Arc<dyn PeerConnection>) {
    use webrtc::peer_connection::{RTCStatsReportEntry, StatsSelector};
    let report = connection.get_stats(std::time::Instant::now(), StatsSelector::None).await;
    let describe = |id: &str| match report.get(id) {
        Some(RTCStatsReportEntry::LocalCandidate(c) | RTCStatsReportEntry::RemoteCandidate(c)) => {
            format!("{:?} {}:{}", c.candidate_type, c.address.as_deref().unwrap_or("?"), c.port)
        }
        _ => id.to_string(),
    };
    let pairs: Vec<String> = report
        .candidate_pairs()
        .map(|p| {
            format!(
                "{} <-> {} {:?}{}, checks sent {} answered {}, received {} answered {}",
                describe(&p.local_candidate_id),
                describe(&p.remote_candidate_id),
                p.state,
                if p.nominated { " nominated" } else { "" },
                p.requests_sent,
                p.responses_received,
                p.requests_received,
                p.responses_sent,
            )
        })
        .collect();
    trace(&format!("pc{pc}: ICE connected over {} candidate pair(s)", pairs.len()));
    for line in pairs {
        trace(&format!("pc{pc}:   {line}"));
    }
}

fn post_state(sink: &Sink, pc: u32, which: Which, value: String) {
    if value.is_empty() {
        return;
    }
    trace(&format!("pc{pc}: {which:?} {value}"));
    sink.post(Out::State { pc, which, value });
}

/// A channel's two tasks: its events to the page, and the page's sends to it.
fn start_channel(dc: u32, channel: Arc<dyn DataChannel>, rx: UnboundedReceiver<DcCmd>, sink: Sink) {
    let runtime = crate::net::runtime();
    let (events, sends) = (channel.clone(), channel);
    let sink2 = sink.clone();
    runtime.spawn(async move {
        let mut received = 0u64;
        while let Some(event) = events.poll().await {
            match event {
                DataChannelEvent::OnOpen => {
                    trace(&format!("dc{dc}: open"));
                    sink.post(Out::ChannelState { dc, event: ChannelEvent::Open });
                }
                DataChannelEvent::OnMessage(m) => {
                    received += 1;
                    if sampled(received) {
                        trace(&format!("dc{dc}: message {received} in ({} bytes)", m.data.len()));
                    }
                    sink.post(Out::Message { dc, data: m.data.to_vec(), text: m.is_string });
                }
                DataChannelEvent::OnClosing => sink.post(Out::ChannelState { dc, event: ChannelEvent::Closing }),
                DataChannelEvent::OnError => sink.post(Out::ChannelState { dc, event: ChannelEvent::Error }),
                DataChannelEvent::OnClose => break,
                _ => {}
            }
        }
        trace(&format!("dc{dc}: closed"));
        sink.post(Out::ChannelState { dc, event: ChannelEvent::Close });
    });
    runtime.spawn(send_loop(dc, sends, rx, sink2));
}

/// How often a channel's backlog is read again while SCTP still holds bytes (bufferedAmount falls between sends).
const DRAIN_POLL: Duration = Duration::from_millis(25);

/// The trace names a channel's first messages each way, then one in a thousand.
fn sampled(n: u64) -> bool {
    n <= 3 || n % 1000 == 0
}

async fn send_loop(dc: u32, channel: Arc<dyn DataChannel>, mut rx: UnboundedReceiver<DcCmd>, sink: Sink) {
    let mut outstanding = 0usize;
    let mut messages_sent = 0u64;
    loop {
        let first = if outstanding > 0 {
            match tokio::time::timeout(DRAIN_POLL, rx.recv()).await {
                Ok(cmd) => cmd,
                Err(_) => {
                    let now = channel.outstanding_bytes().await.unwrap_or(0);
                    if now != outstanding {
                        outstanding = now;
                        sink.post(Out::Drained { dc, sent: 0, outstanding });
                    }
                    continue;
                }
            }
        } else {
            rx.recv().await
        };
        let Some(first) = first else { return };
        let mut batch = vec![first];
        while let Ok(more) = rx.try_recv() {
            batch.push(more);
        }
        let mut sent = 0;
        for cmd in batch {
            match cmd {
                DcCmd::Send(data, text) => {
                    sent += data.len();
                    messages_sent += 1;
                    if sampled(messages_sent) {
                        trace(&format!("dc{dc}: message {messages_sent} out ({} bytes)", data.len()));
                    }
                    let r = if text {
                        channel.send_text(&String::from_utf8_lossy(&data)).await
                    } else {
                        channel.send(bytes::BytesMut::from(&data[..])).await
                    };
                    if let Err(e) = r {
                        trace(&format!("dc{dc}: send failed: {e}"));
                    }
                }
                DcCmd::Close => {
                    let _ = channel.close().await;
                }
            }
        }
        outstanding = channel.outstanding_bytes().await.unwrap_or(0);
        sink.post(Out::Drained { dc, sent, outstanding });
    }
}

// ── the page's side ────────────────────────────────────────────────────

/// An object's event handlers: `on<type>` properties and listeners (closures, retained here).
#[derive(Default)]
struct Listeners {
    on: Vec<(String, u64)>,
    added: Vec<(String, u64)>,
}

impl Listeners {
    fn set_on(&mut self, kind: &str, closure: Option<u64>) {
        if let Some(c) = closure {
            crate::abi::closure_retain(c);
        }
        if let Some(i) = self.on.iter().position(|(k, _)| k == kind) {
            let (_, old) = self.on.remove(i);
            crate::abi::closure_release(old);
        }
        if let Some(c) = closure {
            self.on.push((kind.to_string(), c));
        }
    }

    fn on(&self, kind: &str) -> Value {
        self.on.iter().find(|(k, _)| k == kind).map_or(Value::Null, |(_, c)| Value::Closure(*c))
    }

    fn listen(&mut self, add: bool, kind: &str, closure: u64) {
        let at = self.added.iter().position(|(k, c)| k == kind && *c == closure);
        match (add, at) {
            (true, None) => {
                crate::abi::closure_retain(closure);
                self.added.push((kind.to_string(), closure));
            }
            (false, Some(i)) => {
                self.added.remove(i);
                crate::abi::closure_release(closure);
            }
            _ => {}
        }
    }

    fn handlers(&self, kind: &str) -> Vec<u64> {
        self.on.iter().chain(self.added.iter()).filter(|(k, _)| k == kind).map(|(_, c)| *c).collect()
    }

    fn clear(&mut self) {
        for (_, c) in self.on.drain(..).chain(self.added.drain(..)) {
            crate::abi::closure_release(c);
        }
    }
}

struct Peer {
    /// The program's object (not held: its release frees this entry).
    obj: u64,
    listeners: Listeners,
    signaling: String,
    gathering: String,
    ice: String,
    connection: String,
    local: Option<Description>,
    remote: Option<Description>,
    cmd: UnboundedSender<Cmd>,
    closed: bool,
    channels: Vec<u32>,
    /// performance.now() at setRemoteDescription, for the trace's time to "connected".
    negotiated_at: Option<f64>,
}

struct Channel {
    obj: u64,
    pc: u32,
    info: ChannelInfo,
    id: Option<u16>,
    state: &'static str,
    binary_type: String,
    /// Bytes handed to send() and not yet to SCTP, and what SCTP last said it holds.
    queued: usize,
    outstanding: usize,
    low_threshold: f64,
    listeners: Listeners,
    tx: UnboundedSender<DcCmd>,
}

impl Channel {
    fn buffered(&self) -> usize {
        self.queued + self.outstanding
    }
}

thread_local! {
    static PEERS: RefCell<HashMap<u32, Peer>> = RefCell::new(HashMap::new());
    static CHANNELS: RefCell<HashMap<u32, Channel>> = RefCell::new(HashMap::new());
    static SINK: RefCell<Option<Sink>> = const { RefCell::new(None) };
}

fn sink() -> Sink {
    SINK.with(|s| {
        s.borrow_mut()
            .get_or_insert_with(|| Sink { queue: Arc::new(Mutex::new(VecDeque::new())), doorbell: Doorbell::here() })
            .clone()
    })
}

fn with_peer<R>(id: u32, f: impl FnOnce(&mut Peer) -> R) -> Option<R> {
    PEERS.with(|p| p.borrow_mut().get_mut(&id).map(f))
}

fn with_channel<R>(id: u32, f: impl FnOnce(&mut Channel) -> R) -> Option<R> {
    CHANNELS.with(|c| c.borrow_mut().get_mut(&id).map(f))
}

fn throw(name: &str, message: &str) -> String {
    crate::abi::throw(values::new_error(name, message))
}

fn field(v: &Value, name: &str) -> Value {
    match v {
        Value::Object(r) => objects::get(*r, name).unwrap_or(Value::Undefined),
        _ => Value::Undefined,
    }
}

fn text(v: &Value) -> Option<String> {
    match v {
        Value::Undefined | Value::Null => None,
        other => Some(objects::to_display(other)),
    }
}

/// An array's items (a non-array is one item).
fn items(v: &Value) -> Vec<Value> {
    match v {
        Value::Object(r) if values::is_array(*r) => {
            let len = match objects::get(*r, "length") {
                Ok(Value::Number(n)) => n as usize,
                _ => 0,
            };
            (0..len).map(|i| objects::get(*r, &i.to_string()).unwrap_or(Value::Undefined)).collect()
        }
        Value::Undefined | Value::Null => Vec::new(),
        other => vec![other.clone()],
    }
}

/// What a connection is built with.
struct Config {
    servers: Vec<RTCIceServer>,
    /// `iceTransportPolicy: "relay"`: TURN relays only (no host or reflexive candidate, so no address of this machine).
    relay_only: bool,
}

/// `new RTCPeerConnection(configuration)`: its id (the connection is built on the network runtime meanwhile).
pub fn construct(args: &[Value]) -> Result<u32, String> {
    let config = args.first().cloned().unwrap_or(Value::Undefined);
    let relay_only = match text(&field(&config, "iceTransportPolicy")).as_deref() {
        None | Some("all") => false,
        Some("relay") => true,
        Some(other) => return Err(throw("TypeError", &format!("Failed to construct 'RTCPeerConnection': The provided value '{other}' is not a valid enum value of type RTCIceTransportPolicy."))),
    };
    let mut servers = Vec::new();
    for server in items(&field(&config, "iceServers")) {
        let urls: Vec<String> = items(&field(&server, "urls")).iter().filter_map(text).collect();
        if urls.is_empty() {
            return Err(throw("SyntaxError", "Failed to construct 'RTCPeerConnection': an ICE server has no URLs."));
        }
        servers.push(RTCIceServer {
            urls,
            username: text(&field(&server, "username")).unwrap_or_default(),
            credential: text(&field(&server, "credential")).unwrap_or_default(),
        });
    }
    let id = NEXT_PEER.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = unbounded_channel();
    let sink = sink();
    trace(&format!("pc{id}: new ({} ICE server entries)", servers.len()));
    crate::net::runtime().spawn(run_peer(id, Config { servers, relay_only }, rx, tx.clone(), sink));
    PEERS.with(|p| {
        p.borrow_mut().insert(id, Peer {
            obj: 0,
            listeners: Listeners::default(),
            signaling: "stable".into(),
            gathering: "new".into(),
            ice: "new".into(),
            connection: "new".into(),
            local: None,
            remote: None,
            cmd: tx,
            closed: false,
            channels: Vec::new(),
            negotiated_at: None,
        })
    });
    Ok(id)
}

/// The program's object for a connection, once made (its events' target).
pub fn set_peer_object(id: u32, obj: u64) {
    with_peer(id, |p| p.obj = obj);
}

fn set_channel_object(id: u32, obj: u64) {
    with_channel(id, |c| c.obj = obj);
}

fn description_value(d: &Option<Description>) -> Value {
    match d {
        Some(d) => {
            let o = values::new_object();
            if let Value::Object(r) = o {
                let _ = values::set(r, "type", Value::Str(d.kind.clone()));
                let _ = values::set(r, "sdp", Value::Str(d.sdp.clone()));
            }
            o
        }
        None => Value::Null,
    }
}

const PEER_EVENTS: &[&str] = &[
    "icecandidate", "icegatheringstatechange", "iceconnectionstatechange", "connectionstatechange", "signalingstatechange",
    "datachannel", "negotiationneeded", "icecandidateerror",
];

pub fn peer_get(id: u32, name: &str) -> Option<Value> {
    with_peer(id, |p| {
        Some(match name {
            "signalingState" => Value::Str(p.signaling.clone()),
            "iceGatheringState" => Value::Str(p.gathering.clone()),
            "iceConnectionState" => Value::Str(p.ice.clone()),
            "connectionState" => Value::Str(p.connection.clone()),
            "localDescription" | "pendingLocalDescription" | "currentLocalDescription" => description_value(&p.local),
            "remoteDescription" | "pendingRemoteDescription" | "currentRemoteDescription" => description_value(&p.remote),
            _ => match name.strip_prefix("on") {
                Some(kind) if PEER_EVENTS.contains(&kind) => p.listeners.on(kind),
                _ => return None,
            },
        })
    })
    .flatten()
}

pub fn peer_set(id: u32, name: &str, value: &Value) -> Result<(), String> {
    match name.strip_prefix("on") {
        Some(kind) if PEER_EVENTS.contains(&kind) => {
            let closure = match value {
                Value::Closure(c) => Some(*c),
                _ => None,
            };
            with_peer(id, |p| p.listeners.set_on(kind, closure));
            Ok(())
        }
        _ => Err(format!("cannot set '{name}' on an RTCPeerConnection")),
    }
}

pub const PEER_METHODS: &[&str] = &[
    "createOffer", "createAnswer", "setLocalDescription", "setRemoteDescription", "createDataChannel", "close",
    "addEventListener", "removeEventListener",
];

fn held_promise() -> (Value, u64) {
    let promise = values::new_promise();
    let Value::Object(r) = promise else { unreachable!() };
    objects::retain(r);
    (promise, r)
}

fn rejected(name: &str, message: &str) -> Value {
    let promise = values::new_promise();
    if let Value::Object(r) = promise {
        values::settle(r, true, &values::new_error(name, message));
    }
    promise
}

fn description_arg(v: &Value) -> Option<Description> {
    let kind = text(&field(v, "type"))?;
    Some(Description { kind, sdp: text(&field(v, "sdp")).unwrap_or_default() })
}

pub fn peer_call(id: u32, name: &str, args: &[Value]) -> Result<Value, String> {
    let Some((closed, signaling, cmd)) = with_peer(id, |p| (p.closed, p.signaling.clone(), p.cmd.clone())) else {
        return Err(format!("{name}: a released RTCPeerConnection"));
    };
    let queue = |make: &dyn Fn(u64) -> Cmd| -> Value {
        if closed {
            return rejected("InvalidStateError", &format!("Failed to execute '{name}' on 'RTCPeerConnection': The RTCPeerConnection's signalingState is 'closed'."));
        }
        let (promise, r) = held_promise();
        if cmd.send(make(r)).is_err() {
            values::settle(r, true, &values::new_error("OperationError", "the connection's engine is gone"));
            objects::release(r);
        }
        promise
    };
    match name {
        "createOffer" => Ok(queue(&Cmd::CreateOffer)),
        "createAnswer" => Ok(queue(&Cmd::CreateAnswer)),
        "setLocalDescription" => {
            let description = args.first().and_then(description_arg);
            let implicit = if signaling == "have-remote-offer" { RTCSdpType::Answer } else { RTCSdpType::Offer };
            Ok(queue(&|p| Cmd::SetLocal(p, description.clone(), implicit)))
        }
        "setRemoteDescription" => {
            let Some(description) = args.first().and_then(description_arg) else {
                return Ok(rejected("TypeError", "Failed to execute 'setRemoteDescription' on 'RTCPeerConnection': The description has no type."));
            };
            with_peer(id, |p| p.negotiated_at = Some(crate::timers::now_ms()));
            Ok(queue(&|p| Cmd::SetRemote(p, description.clone())))
        }
        "createDataChannel" => {
            if closed {
                return Err(throw("InvalidStateError", "Failed to execute 'createDataChannel' on 'RTCPeerConnection': The RTCPeerConnection's signalingState is 'closed'."));
            }
            let label = args.first().map(objects::to_display).unwrap_or_default();
            let options = args.get(1).cloned().unwrap_or(Value::Undefined);
            let number = |n: &str| match field(&options, n) {
                Value::Number(v) if v.is_finite() && v >= 0.0 => Some(v.min(65535.0) as u16),
                _ => None,
            };
            let ordered = !matches!(field(&options, "ordered"), Value::Bool(false));
            let max_retransmits = number("maxRetransmits");
            let max_packet_life_time = number("maxPacketLifeTime");
            if max_retransmits.is_some() && max_packet_life_time.is_some() {
                return Err(throw("TypeError", "Failed to execute 'createDataChannel' on 'RTCPeerConnection': RTCDataChannelInit cannot have both maxRetransmits and maxPacketLifeTime."));
            }
            let negotiated = matches!(field(&options, "negotiated"), Value::Bool(true));
            let stream = number("id");
            if negotiated && stream.is_none() {
                return Err(throw("TypeError", "Failed to execute 'createDataChannel' on 'RTCPeerConnection': RTCDataChannelInit.negotiated is true and id is not set."));
            }
            let protocol = text(&field(&options, "protocol")).unwrap_or_default();
            let init = RTCDataChannelInit {
                ordered,
                max_packet_life_time,
                max_retransmits,
                protocol: protocol.clone(),
                negotiated: if negotiated { stream } else { None },
            };
            let dc = NEXT_CHANNEL.fetch_add(1, Ordering::Relaxed);
            let (tx, rx) = unbounded_channel();
            let info = ChannelInfo { label: label.clone(), protocol, ordered, max_retransmits, max_packet_life_time, negotiated };
            add_channel(id, dc, info, if negotiated { stream } else { None }, tx);
            trace(&format!("pc{id}: createDataChannel '{label}' (dc{dc}, ordered {ordered}, maxRetransmits {max_retransmits:?})"));
            let _ = cmd.send(Cmd::Channel { dc, label, init, rx });
            Ok(channel_value(dc))
        }
        "close" => {
            close_peer(id);
            Ok(Value::Undefined)
        }
        "addEventListener" | "removeEventListener" => {
            if let (Some(kind), Some(Value::Closure(c))) = (args.first(), args.get(1)) {
                let kind = objects::to_display(kind);
                with_peer(id, |p| p.listeners.listen(name == "addEventListener", &kind, *c));
            }
            Ok(Value::Undefined)
        }
        _ => Err(format!("{name} is not a function")),
    }
}

fn add_channel(pc: u32, dc: u32, info: ChannelInfo, id: Option<u16>, tx: UnboundedSender<DcCmd>) {
    CHANNELS.with(|c| {
        c.borrow_mut().insert(dc, Channel {
            obj: 0,
            pc,
            info,
            id,
            state: "connecting",
            binary_type: "blob".into(),
            queued: 0,
            outstanding: 0,
            low_threshold: 0.0,
            listeners: Listeners::default(),
            tx,
        })
    });
    with_peer(pc, |p| p.channels.push(dc));
}

/// A new object for a channel (fresh: the program's hold keeps it).
fn channel_value(dc: u32) -> Value {
    let v = objects::new_rtc_channel(dc);
    if let Value::Object(r) = v {
        set_channel_object(dc, r);
    }
    v
}

/// `close()`: the connection and its channels "closed" at once, with no events; their handlers let go.
fn close_peer(id: u32) {
    let Some((channels, cmd)) = with_peer(id, |p| {
        if p.closed {
            return None;
        }
        p.closed = true;
        p.signaling = "closed".into();
        p.ice = "closed".into();
        p.connection = "closed".into();
        p.listeners.clear();
        Some((p.channels.clone(), p.cmd.clone()))
    })
    .flatten() else {
        return;
    };
    for dc in channels {
        with_channel(dc, |c| {
            c.state = "closed";
            c.listeners.clear();
        });
    }
    trace(&format!("pc{id}: close()"));
    let _ = cmd.send(Cmd::Close);
}

/// The program let go of a connection's object: it closes, and its entry goes.
pub fn peer_freed(id: u32) {
    close_peer(id);
    let channels = PEERS.with(|p| p.borrow_mut().remove(&id).map(|p| p.channels)).unwrap_or_default();
    for dc in channels {
        // A channel whose object the program still holds stays (closed); one it let go of is gone already.
        let gone = with_channel(dc, |c| c.obj == 0).unwrap_or(false);
        if gone {
            CHANNELS.with(|c| c.borrow_mut().remove(&dc));
        }
    }
}

const CHANNEL_EVENTS: &[&str] = &["open", "message", "bufferedamountlow", "error", "closing", "close"];

pub fn channel_get(id: u32, name: &str) -> Option<Value> {
    with_channel(id, |c| {
        let opt = |v: Option<u16>| v.map_or(Value::Null, |n| Value::Number(f64::from(n)));
        Some(match name {
            "label" => Value::Str(c.info.label.clone()),
            "protocol" => Value::Str(c.info.protocol.clone()),
            "ordered" => Value::Bool(c.info.ordered),
            "maxRetransmits" => opt(c.info.max_retransmits),
            "maxPacketLifeTime" => opt(c.info.max_packet_life_time),
            "negotiated" => Value::Bool(c.info.negotiated),
            "id" => opt(c.id),
            "readyState" => Value::Str(c.state.into()),
            "binaryType" => Value::Str(c.binary_type.clone()),
            "bufferedAmount" => Value::Number(c.buffered() as f64),
            "bufferedAmountLowThreshold" => Value::Number(c.low_threshold),
            _ => match name.strip_prefix("on") {
                Some(kind) if CHANNEL_EVENTS.contains(&kind) => c.listeners.on(kind),
                _ => return None,
            },
        })
    })
    .flatten()
}

pub fn channel_set(id: u32, name: &str, value: &Value) -> Result<(), String> {
    match name {
        "binaryType" => {
            let t = objects::to_display(value);
            if t != "blob" && t != "arraybuffer" {
                return Err(throw("SyntaxError", &format!("Failed to set the 'binaryType' property on 'RTCDataChannel': '{t}' is not a valid value.")));
            }
            with_channel(id, |c| c.binary_type = t);
            Ok(())
        }
        "bufferedAmountLowThreshold" => {
            let n = match value {
                Value::Number(n) if n.is_finite() && *n >= 0.0 => n.min(f64::from(u32::MAX)).floor(),
                _ => 0.0,
            };
            with_channel(id, |c| c.low_threshold = n);
            Ok(())
        }
        _ => match name.strip_prefix("on") {
            Some(kind) if CHANNEL_EVENTS.contains(&kind) => {
                let closure = match value {
                    Value::Closure(c) => Some(*c),
                    _ => None,
                };
                with_channel(id, |c| c.listeners.set_on(kind, closure));
                Ok(())
            }
            _ => Err(format!("cannot set '{name}' on an RTCDataChannel")),
        },
    }
}

pub const CHANNEL_METHODS: &[&str] = &["send", "close", "addEventListener", "removeEventListener"];

pub fn channel_call(id: u32, name: &str, args: &[Value]) -> Result<Value, String> {
    match name {
        "send" => {
            let (data, is_text) = match args.first() {
                Some(Value::Str(s)) => (s.clone().into_bytes(), true),
                Some(Value::Object(r)) => match values::bytes_of(*r) {
                    Some((_, bytes)) => (bytes, false),
                    // A Blob goes out as its bytes, binary (the compiled page sends its frames in Blobs).
                    None => match objects::blob_of(*r) {
                        Some(blob) => (blob.bytes.as_ref().clone(), false),
                        None => return Err(throw("TypeError", "Failed to execute 'send' on 'RTCDataChannel': the data is not a string, a Blob, an ArrayBuffer or a view of one.")),
                    },
                },
                Some(other) => (objects::to_display(other).into_bytes(), true),
                None => return Err(throw("TypeError", "Failed to execute 'send' on 'RTCDataChannel': 1 argument required, but only 0 present.")),
            };
            let sent = with_channel(id, |c| {
                if c.state != "open" {
                    return Err(c.state);
                }
                c.queued += data.len();
                let len = data.len();
                if c.tx.send(DcCmd::Send(data, is_text)).is_err() {
                    c.queued -= len;
                }
                Ok(())
            });
            match sent {
                Some(Ok(())) => Ok(Value::Undefined),
                Some(Err(state)) => Err(throw("InvalidStateError", &format!("Failed to execute 'send' on 'RTCDataChannel': RTCDataChannel.readyState is not 'open' (it is '{state}')"))),
                None => Err(throw("InvalidStateError", "Failed to execute 'send' on 'RTCDataChannel': a released RTCDataChannel")),
            }
        }
        "close" => {
            with_channel(id, |c| {
                if c.state == "connecting" || c.state == "open" {
                    c.state = "closing";
                    let _ = c.tx.send(DcCmd::Close);
                }
            });
            Ok(Value::Undefined)
        }
        "addEventListener" | "removeEventListener" => {
            if let (Some(kind), Some(Value::Closure(c))) = (args.first(), args.get(1)) {
                let kind = objects::to_display(kind);
                with_channel(id, |ch| ch.listeners.listen(name == "addEventListener", &kind, *c));
            }
            Ok(Value::Undefined)
        }
        _ => Err(format!("{name} is not a function")),
    }
}

/// The program let go of a channel's object: its handlers go (the channel itself stays open while its connection is,
/// as a browser keeps it).
pub fn channel_freed(id: u32) {
    let remove = with_channel(id, |c| {
        c.obj = 0;
        c.listeners.clear();
        PEERS.with(|p| !p.borrow().contains_key(&c.pc))
    })
    .unwrap_or(false);
    if remove {
        CHANNELS.with(|c| c.borrow_mut().remove(&id));
    }
}

// ── delivery ───────────────────────────────────────────────────────────

/// Engine posts wait on this thread, or a connection is open (the loop's io_pending).
pub fn pending() -> bool {
    let queued = SINK.with(|s| s.borrow().as_ref().is_some_and(|s| !s.queue.lock().unwrap_or_else(|e| e.into_inner()).is_empty()));
    queued || PEERS.with(|p| p.borrow().values().any(|p| !p.closed))
}

/// Posts are waiting to be run now (the loop does not sleep).
pub fn due() -> bool {
    SINK.with(|s| s.borrow().as_ref().is_some_and(|s| !s.queue.lock().unwrap_or_else(|e| e.into_inner()).is_empty()))
}

/// An event `{ type, target, currentTarget, ...extra }` fired at `obj` through `handlers`, as one task. True when a
/// handler threw (the exception stays pending; the loop reports it).
fn fire(obj: u64, handlers: Vec<u64>, kind: &str, extra: &[(&str, Value)]) -> bool {
    if handlers.is_empty() {
        return false;
    }
    let event = values::new_object();
    if let Value::Object(e) = event {
        let _ = values::set(e, "type", Value::Str(kind.into()));
        if obj != 0 {
            let _ = values::set(e, "target", Value::Object(obj));
            let _ = values::set(e, "currentTarget", Value::Object(obj));
        }
        for (k, v) in extra {
            let _ = values::set(e, k, v.clone());
        }
    }
    for h in handlers {
        crate::abi::closure_retain(h);
        let threw = crate::abi::call_closure(h, std::slice::from_ref(&event)).is_err();
        crate::abi::closure_release(h);
        if threw {
            return true;
        }
    }
    false
}

fn peer_event(pc: u32, kind: &str) -> Option<(u64, Vec<u64>)> {
    with_peer(pc, |p| if p.closed { None } else { Some((p.obj, p.listeners.handlers(kind))) }).flatten()
}

fn channel_event(dc: u32, kind: &str) -> Option<(u64, Vec<u64>)> {
    with_channel(dc, |c| (c.obj, c.listeners.handlers(kind)))
}

/// Runs this thread's due posts, each a task of its own (microtasks between them). True when a handler threw.
pub fn run() -> bool {
    let Some(queue) = SINK.with(|s| s.borrow().as_ref().map(|s| s.queue.clone())) else { return false };
    loop {
        let Some(out) = queue.lock().unwrap_or_else(|e| e.into_inner()).pop_front() else { return false };
        let _op = objects::Op::enter();
        let threw = deliver(out);
        drop(_op);
        if threw {
            return true;
        }
        values::run_jobs();
    }
}

fn deliver(out: Out) -> bool {
    match out {
        Out::Settle { pc, promise, result } => {
            let mut threw = false;
            match result {
                Ok(Settled::Description(d)) => values::settle(promise, false, &description_value(&Some(d))),
                Ok(Settled::Applied { local, applied, current }) => {
                    // The signaling state moves (and its event fires) before the promise resolves.
                    let changed = with_peer(pc, |p| {
                        if p.closed {
                            return None;
                        }
                        let next = match (local, applied.kind.as_str()) {
                            (true, "offer") => "have-local-offer",
                            (false, "offer") => "have-remote-offer",
                            _ => "stable",
                        };
                        if local {
                            p.local = current.or(Some(applied));
                        } else {
                            p.remote = Some(applied);
                        }
                        (p.signaling != next).then(|| p.signaling = next.into())
                    })
                    .flatten();
                    if changed.is_some()
                        && let Some((obj, handlers)) = peer_event(pc, "signalingstatechange")
                    {
                        threw = fire(obj, handlers, "signalingstatechange", &[]);
                    }
                    values::settle(promise, false, &Value::Undefined);
                }
                Err((name, message)) => values::settle(promise, true, &values::new_error(&name, &message)),
            }
            objects::release(promise);
            threw
        }
        Out::State { pc, which, value } => {
            let (kind, changed) = match with_peer(pc, |p| {
                if p.closed {
                    return None;
                }
                let (slot, kind) = match which {
                    Which::Gathering => (&mut p.gathering, "icegatheringstatechange"),
                    Which::Ice => (&mut p.ice, "iceconnectionstatechange"),
                    Which::Connection => (&mut p.connection, "connectionstatechange"),
                };
                let changed = *slot != value;
                *slot = value.clone();
                if matches!(which, Which::Connection) && value == "connected"
                    && let Some(at) = p.negotiated_at.take()
                {
                    trace(&format!("pc{pc}: connected {:.0} ms after setRemoteDescription", crate::timers::now_ms() - at));
                }
                Some((kind, changed))
            })
            .flatten()
            {
                Some(x) => x,
                None => return false,
            };
            if !changed {
                return false;
            }
            match peer_event(pc, kind) {
                Some((obj, handlers)) => fire(obj, handlers, kind, &[]),
                None => false,
            }
        }
        Out::LocalDescription { pc, description } => {
            with_peer(pc, |p| {
                if !p.closed && p.local.as_ref().is_some_and(|l| l.kind == description.kind) {
                    p.local = Some(description);
                }
            });
            false
        }
        Out::IceCandidate { pc, candidate } => {
            let Some((obj, handlers)) = peer_event(pc, "icecandidate") else { return false };
            let value = match candidate {
                Some(c) => {
                    let o = values::new_object();
                    if let Value::Object(r) = o {
                        let _ = values::set(r, "candidate", Value::Str(c.candidate));
                        let _ = values::set(r, "sdpMid", c.sdp_mid.map_or(Value::Null, Value::Str));
                        let _ = values::set(r, "sdpMLineIndex", c.sdp_mline_index.map_or(Value::Null, |n| Value::Number(f64::from(n))));
                    }
                    o
                }
                None => Value::Null,
            };
            fire(obj, handlers, "icecandidate", &[("candidate", value)])
        }
        Out::Announced { pc, dc, info, tx } => {
            if with_peer(pc, |p| p.closed).unwrap_or(true) {
                let _ = tx.send(DcCmd::Close);
                return false;
            }
            add_channel(pc, dc, info, None, tx);
            let channel = channel_value(dc);
            match peer_event(pc, "datachannel") {
                Some((obj, handlers)) => fire(obj, handlers, "datachannel", &[("channel", channel)]),
                None => false,
            }
        }
        Out::ChannelState { dc, event } => {
            let fired = with_channel(dc, |c| {
                let kind = match event {
                    ChannelEvent::Open if c.state == "connecting" => {
                        c.state = "open";
                        "open"
                    }
                    ChannelEvent::Closing if c.state == "open" || c.state == "connecting" => {
                        c.state = "closing";
                        "closing"
                    }
                    ChannelEvent::Close if c.state != "closed" => {
                        c.state = "closed";
                        "close"
                    }
                    ChannelEvent::Error => "error",
                    _ => return None,
                };
                Some((kind, c.obj, c.listeners.handlers(kind)))
            })
            .flatten();
            let Some((kind, obj, handlers)) = fired else { return false };
            let threw = fire(obj, handlers, kind, &[]);
            if kind == "close" {
                // Closed for good: nothing more fires, and the handlers let go.
                with_channel(dc, |c| c.listeners.clear());
            }
            threw
        }
        Out::Message { dc, data, text } => {
            let Some((obj, handlers)) = channel_event(dc, "message") else { return false };
            if handlers.is_empty() || with_channel(dc, |c| c.state != "open").unwrap_or(true) {
                trace(&format!("dc{dc}: a message dropped (no listener, or the channel is not open)"));
                return false;
            }
            let data = if text { Value::Str(String::from_utf8_lossy(&data).into_owned()) } else { values::new_bytes(values::U8, data) };
            fire(obj, handlers, "message", &[("data", data)])
        }
        Out::Drained { dc, sent, outstanding } => {
            let low = with_channel(dc, |c| {
                let before = c.buffered() as f64;
                c.queued = c.queued.saturating_sub(sent);
                c.outstanding = outstanding;
                let after = c.buffered() as f64;
                (before > c.low_threshold && after <= c.low_threshold && c.state == "open").then(|| (c.obj, c.listeners.handlers("bufferedamountlow")))
            })
            .flatten();
            match low {
                Some((obj, handlers)) => fire(obj, handlers, "bufferedamountlow", &[]),
                None => false,
            }
        }
        Out::Failed { pc, message } => {
            trace(&format!("pc{pc}: failed: {message}"));
            let Some(changed) = with_peer(pc, |p| {
                if p.closed || p.connection == "failed" {
                    return false;
                }
                p.connection = "failed".into();
                p.ice = "failed".into();
                true
            }) else {
                return false;
            };
            if !changed {
                return false;
            }
            match peer_event(pc, "connectionstatechange") {
                Some((obj, handlers)) => fire(obj, handlers, "connectionstatechange", &[]),
                None => false,
            }
        }
    }
}
