//! The host's requests and its host modules: the loop's worker pool (the network threads and the CPU work), the
//! page's `fetch()` global and its Response, the document's own loads (stylesheets, images, fonts), and the runtime's
//! `fetch()` (scr_fetch.c's host transport, [`scr_host_fetch_transport`]), all carried by the one network layer
//! (net.rs). A layer's host modules (layer.rs) build on the same pool ([`submit_then`], [`submit_net_then`],
//! [`spawn_waiter_then`]) and routing ([`carry`]).
//!
//! Every request resolves against the page URL (`<PREFIX>PAGE_URL`, else `http://localhost/`). A URL of the page's
//! origin, or a file: URL, names a file under the document root (`<PREFIX>FETCH_ROOT`); one that is not there streams
//! from where the layer says (net.rs `remote_for`). The page's API paths (`/api/` on its origin, any method) go to its
//! API origin when there is one ([`api_origin`]). Any other http(s) URL goes over the network through net.rs, with its
//! HTTP cache and cookie jar. Requests run on worker threads and settle on a later loop turn.
//!
//! - The page's `fetch()` global: settled with a Response host object (status, ok, statusText, url, headers; text /
//!   json / arrayBuffer / bytes, the body read once). An init's method, headers (a record or a Headers) and body (a
//!   string or bytes), its cache mode and its signal (an abort rejects the fetch; the request itself runs to the end)
//!   are honoured.
//! - The runtime's `fetch()`: the same routing, the reply handed back to the runtime, which builds the Response.
//! - Host modules: the layer's first ([`call`]); the host's own is `scriptc:page-import` (a worker piece's
//!   constructor for a `?worker` import: workers.rs). Any other throws a TypeError naming it.

use std::cell::RefCell;
use std::ffi::c_void;
use std::path::{Component, Path, PathBuf};
use std::sync::mpsc::{Receiver, Sender, channel};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use crate::net;
use crate::objects::{self, Value};
use crate::values;

/// Why a host-module call failed: a TypeError's message, or a thrown value (an Error of another name).
pub enum Failure {
    Message(String),
    Thrown(Value),
}

/// Worker threads for the work that uses the CPU (image decodes) and for whatever else blocks briefly.
const WORKERS: usize = 4;
/// Threads for network requests and file reads, which each hold a thread until their reply is read in full (net.rs
/// `request` blocks on the network runtime, where the requests themselves share connections and multiplex over
/// HTTP/2). A page may ask for hundreds of files: four threads (the old pool, shared with decodes) held the host to
/// about 30 requests a second against a browser's dozens in flight, so a first run took minutes to stream the render thread.
const NET_WORKERS: usize = 32;

pub type Work = Box<dyn FnOnce() -> Done + Send>;
/// A job whose answer is a closure run on the loop's thread.
pub type ThenWork = Box<dyn FnOnce() -> Box<dyn FnOnce() + Send> + Send>;

/// A finished request, back on the loop thread.
pub enum Done {
    /// The page's fetch(): the Response, or a TypeError message.
    Fetch { promise: u64, reply: Result<Reply, String> },
    /// The runtime's fetch: the transfer's token and the reply, or why it failed.
    Transfer { token: usize, reply: Result<Reply, String> },
    /// Work whose answer settles itself on the loop thread ([`submit_then`], [`submit_net_then`],
    /// [`spawn_waiter_then`]: audio decodes, a layer's modules).
    Then(Box<dyn FnOnce() + Send>),
    /// No request: a wait woken early ([`Waker::wake`]).
    Wake,
}

/// A way into one runtime instance's loop from any thread: its pool's completion channel. Waking it ends the loop's
/// wait on the pool at once (the display link's refresh, the runtime's remote inbox, another thread's seam call),
/// which an AppKit event or an inbox post alone does not reach.
#[derive(Clone)]
pub struct Waker(Sender<Done>);

impl Waker {
    pub fn wake(&self) {
        let _ = self.0.send(Done::Wake);
    }
}

/// Sleeps up to `ms` on this instance's pool (made on first use): a completion or a wake ends it early, and what
/// finished is settled.
pub fn sleep(ms: f64) {
    with_pool(|_| ());
    wait(ms);
}

/// The calling thread's instance's waker (its pool made on first use).
pub fn waker() -> Waker {
    with_pool(|pool| Waker(pool.finished.clone()))
}

/// How long `stop` waits for a worker's thread before abandoning it.
/// One reply, read in full.
pub struct Reply {
    pub status: u16,
    pub status_text: String,
    pub url: String,
    /// One `name: value` per line.
    pub headers: String,
    pub body: Vec<u8>,
}

struct Pool {
    jobs: Sender<Work>,
    /// The network threads' queue (NET_WORKERS).
    net_jobs: Sender<Work>,
    done: Receiver<Done>,
    /// For waits that run on threads of their own.
    finished: Sender<Done>,
    /// Requests submitted and not yet settled.
    in_flight: usize,
}

thread_local! {
    static POOL: RefCell<Option<Pool>> = const { RefCell::new(None) };
}

/// The pool (made on first use: its workers and the channel every finished request comes back on).
fn with_pool<R>(f: impl FnOnce(&mut Pool) -> R) -> R {
    POOL.with(|p| {
        let mut p = p.borrow_mut();
        let pool = p.get_or_insert_with(|| {
            let (tx, done) = channel::<Done>();
            // Two queues, each served by its own threads, both answering on the one channel.
            let serve = |count: usize, name: &str| {
                let (jobs, rx) = channel::<Work>();
                let rx = Arc::new(Mutex::new(rx));
                for i in 0..count {
                    let (rx, tx) = (rx.clone(), tx.clone());
                    std::thread::Builder::new()
                        .name(format!("scriptc-host-{name}-{i}"))
                        .spawn(move || loop {
                            let Ok(work) = rx.lock().unwrap().recv() else { return };
                            let _ = tx.send(work());
                        })
                        .expect("scriptc-host: spawn a worker thread");
                }
                jobs
            };
            let jobs = serve(WORKERS, "work");
            let net_jobs = serve(NET_WORKERS, "net");
            Pool { jobs, net_jobs, done, finished: tx, in_flight: 0 }
        });
        f(pool)
    })
}

fn submit(work: Work) {
    with_pool(|pool| {
        pool.in_flight += 1;
        // The workers live as long as the host; a send cannot fail while they do.
        let _ = pool.jobs.send(work);
    })
}

/// CPU work on the pool (an image or audio decode) whose result is a closure run on this loop's thread when it is
/// settled.
pub fn submit_then(work: ThenWork) {
    submit(Box::new(move || Done::Then(work())));
}

/// A network request or file read on the network threads, its answer a closure run on this loop's thread.
pub fn submit_net_then(work: ThenWork) {
    submit_net(Box::new(move || Done::Then(work())));
}

/// A wait that may block for long, on a thread of its own named `name`, its answer a closure run on this loop's thread.
pub fn spawn_waiter_then(name: &str, work: ThenWork) {
    spawn_waiter(name, Box::new(move || Done::Then(work())));
}

/// An `Audio` element's source (audio.rs), read whole on the network threads as the page's fetch() reads it (the page's
/// files, the asset base, the network; a `data:` or live `blob:` URL), the answer settled on this thread by `then`'s
/// closure.
#[cfg(all(windows, feature = "audio"))]
pub fn load_media(raw: String, then: Box<dyn FnOnce(Result<Vec<u8>, String>) -> Box<dyn FnOnce() + Send> + Send>) {
    submit_net(Box::new(move || {
        let bytes = match page().join(&raw) {
            Ok(u) if u.scheme() == "blob" => crate::streams::object_url_bytes(u.as_str()).map(|b| b.as_ref().clone()).ok_or_else(|| format!("{u}: a revoked or unknown object URL")),
            Ok(u) if u.scheme() == "data" => data_url(&u).ok_or_else(|| format!("{u}: an invalid data: URL")),
            Ok(u) => match carry("GET", &u, &[], Vec::new(), "default") {
                Ok(r) if (200..300).contains(&r.status) => Ok(r.body),
                Ok(r) => Err(net::redact(&format!("fetch {u}: {} {}", r.status, r.status_text))),
                Err(e) => Err(net::redact(&e)),
            },
            Err(e) => Err(format!("{raw}: invalid URL ({e})")),
        };
        Done::Then(then(bytes))
    }));
}

/// A network request or file read, on the network threads (NET_WORKERS).
pub fn submit_net(work: Work) {
    with_pool(|pool| {
        pool.in_flight += 1;
        let _ = pool.net_jobs.send(work);
    })
}

/// Runs `work` on a thread of its own (a wait that may block for long), settled like a pooled request.
pub fn spawn_waiter(name: &str, work: Work) {
    let finished = with_pool(|pool| {
        pool.in_flight += 1;
        pool.finished.clone()
    });
    std::thread::Builder::new()
        .name(name.into())
        .spawn(move || {
            let _ = finished.send(work());
        })
        .expect("scriptc-host: spawn a waiter thread");
}

/// Requests in flight keep the program alive (they settle on a later turn).
pub fn pending() -> bool {
    POOL.with(|p| p.borrow().as_ref().is_some_and(|p| p.in_flight > 0))
}

/// Waits at most `max_wait_ms` for the first finished request, then settles every one that has finished.
pub fn wait(max_wait_ms: f64) {
    let mut finished = Vec::new();
    POOL.with(|p| {
        let p = p.borrow();
        let Some(pool) = p.as_ref() else { return };
        if let Ok(done) = pool.done.recv_timeout(Duration::from_secs_f64(max_wait_ms.max(0.0) / 1000.0)) {
            finished.push(done);
            finished.extend(pool.done.try_iter());
        }
    });
    finished.retain(|d| !matches!(d, Done::Wake));
    POOL.with(|p| {
        if let Some(pool) = p.borrow_mut().as_mut() {
            pool.in_flight -= finished.len();
        }
    });
    for done in finished {
        match done {
            Done::Fetch { promise, reply } => {
                match reply {
                    Ok(r) => {
                        let headers = r.headers.lines().filter_map(|l| l.split_once(':')).map(|(n, v)| (n.trim().to_ascii_lowercase(), v.trim().to_string())).collect();
                        let response = objects::new_response(FetchResponse {
                            status: r.status,
                            status_text: r.status_text,
                            url: r.url,
                            headers: std::rc::Rc::new(headers),
                            body: RefCell::new(Some(crate::streams::BodyBytes::Ready(r.body))),
                        });
                        values::settle(promise, false, &response);
                    }
                    Err(message) => values::settle(promise, true, &values::new_error("TypeError", &message)),
                }
                objects::release(promise);
            }
            Done::Transfer { token, reply } => answer_transfer(token as *mut c_void, reply),
            Done::Then(settle) => settle(),
            Done::Wake => {}
        }
    }
}

/// The page's URL, that relative URLs resolve against and whose origin is the document root's.
pub fn page() -> url::Url {
    static PAGE: OnceLock<url::Url> = OnceLock::new();
    PAGE.get_or_init(|| {
        let mut page = crate::config::var("PAGE_URL")
            .ok()
            .and_then(|u| url::Url::parse(&u).ok())
            .filter(|u| !u.cannot_be_a_base())
            .unwrap_or_else(|| url::Url::parse("http://localhost/").unwrap());
        // A link the program was launched with: its fragment (launch.rs), as a browser opening it would have it.
        if let Some(fragment) = crate::launch::launch_fragment() {
            page.set_fragment(Some(&fragment));
        }
        page
    })
    .clone()
}

/// The page's API origin, where its own-origin `/api/` requests go: <PREFIX>API_ORIGIN, else the build's
/// (<PREFIX>RELEASE_API_ORIGIN, compiled in by windows-native-build.mjs). None when neither is set (those requests
/// then answer as any other page-origin path does: a GET reads a file, other methods 404).
pub fn api_origin() -> Option<url::Url> {
    static API: OnceLock<Option<url::Url>> = OnceLock::new();
    API.get_or_init(|| {
        crate::config::var("API_ORIGIN")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .or_else(|| crate::config::get().api_origin.map(String::from))
            .and_then(|s| url::Url::parse(s.trim()).ok())
            .filter(|u| matches!(u.scheme(), "http" | "https") && u.has_host())
    })
    .clone()
}

/// Where a page-origin API request (`/api` or below) goes: the same path and query on the API origin.
pub fn api_url(u: &url::Url) -> Option<url::Url> {
    let path = u.path();
    if !matches!(u.scheme(), "http" | "https") || u.origin() != page().origin() || !(path == "/api" || path.starts_with("/api/")) {
        return None;
    }
    let mut out = api_origin()?;
    out.set_path(path);
    out.set_query(u.query());
    Some(out)
}

/// The document root fetches read under: <PREFIX>FETCH_ROOT, else an install's beside the executable (config.rs
/// `installed_root`; a layer may carry it: what it does not carry streams).
pub fn root() -> Option<PathBuf> {
    static ROOT: OnceLock<Option<PathBuf>> = OnceLock::new();
    ROOT.get_or_init(|| crate::config::var_os("FETCH_ROOT").map(PathBuf::from).or_else(|| crate::installed(crate::config::get().installed_root)).and_then(|r| std::path::absolute(r).ok()))
        .clone()
}

pub fn document_root() -> Option<PathBuf> {
    root()
}

/// The document's own loads (the stylesheets, images and fonts the page names): a file: URL on disk as it is (a
/// stylesheet beside the page), else as the page's fetches route
/// it (under the document root, streamed from the remote asset base when not shipped; http(s) over the network); a
/// data: URL decoded. A load that finds nothing delivers nothing. Read off the program's thread; handed to the
/// document on it ([`deliver_loads`], before a frame resolves), since a handler parses a stylesheet under the lock the
/// style pass holds.
pub struct DocumentNet;

type Loaded = (String, Box<dyn blitz_traits::net::NetHandler>, Vec<u8>);

static LOADED: std::sync::Mutex<Vec<Loaded>> = std::sync::Mutex::new(Vec::new());

impl blitz_traits::net::NetProvider for DocumentNet {
    fn fetch(&self, _doc_id: usize, request: blitz_traits::net::Request, handler: Box<dyn blitz_traits::net::NetHandler>) {
        let u = request.url;
        std::thread::spawn(move || {
            let trace = crate::config::var_os("NET_TRACE").is_some();
            match document_load(&u) {
                Some(bytes) => {
                    if trace {
                        eprintln!("net: {u} delivered ({} bytes)", bytes.len());
                    }
                    LOADED.lock().unwrap_or_else(|e| e.into_inner()).push((u.to_string(), handler, bytes));
                    crate::dom::resource_arrived();
                }
                None if trace => eprintln!("net: {u}: not found"),
                None => {}
            }
        });
    }
}

/// The loads that arrived, handed to the document (on the program's thread; the next resolve takes them in).
pub fn deliver_loads() {
    let loaded = std::mem::take(&mut *LOADED.lock().unwrap_or_else(|e| e.into_inner()));
    for (url, handler, bytes) in loaded {
        handler.bytes(url, blitz_traits::net::Bytes::from(bytes));
    }
}

pub fn document_load(u: &url::Url) -> Option<Vec<u8>> {
    match u.scheme() {
        "data" => return data_url(u),
        // An object URL (URL.createObjectURL): the blob's bytes while it is live.
        "blob" => return crate::streams::object_url_bytes(u.as_str()).map(|b| b.as_ref().clone()),
        "file" => {
            if let Ok(p) = u.to_file_path()
                && crate::is_file(&p)
            {
                return crate::read(&p).ok();
            }
        }
        _ => {}
    }
    let get = |u: &url::Url| net::request("GET", u.as_str(), &[], Vec::new(), net::cache_mode("default")).ok().filter(|r| (200..300).contains(&r.status)).map(|r| r.body);
    match route(u) {
        Route::File(Ok(p)) if crate::is_file(&p) => crate::read(&p).ok(),
        Route::File(Ok(p)) => streamed(u, &p).and_then(|r| streamed_reply("GET", &r, &[], "default").ok()).filter(|r| (200..300).contains(&r.status)).map(|r| r.body),
        Route::Network => get(u),
        Route::File(Err(_)) | Route::Refused(_) => None,
    }
}

/// A data: URL's bytes (`data:[<type>][;base64],<data>`, the data percent-decoded first).
pub fn data_url(u: &url::Url) -> Option<Vec<u8>> {
    let (meta, data) = u.path().split_once(',')?;
    let mut bytes = Vec::with_capacity(data.len());
    let b = data.as_bytes();
    let mut i = 0;
    while i < b.len() {
        match (b[i], b.get(i + 1..i + 3).and_then(|h| std::str::from_utf8(h).ok()).and_then(|h| u8::from_str_radix(h, 16).ok())) {
            (b'%', Some(byte)) => { bytes.push(byte); i += 3; }
            (c, _) => { bytes.push(c); i += 1; }
        }
    }
    if !meta.ends_with(";base64") {
        return Some(bytes);
    }
    let units: Vec<u16> = bytes.iter().map(|&c| u16::from(c)).collect();
    Some(crate::web::atob(&units)?.into_iter().map(|u| u as u8).collect())
}

pub fn percent_decode(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let hex = std::str::from_utf8(b.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// Where a resolved URL goes: a file under the document root (the page's origin, or a file: URL), or the network.
pub enum Route {
    File(Result<PathBuf, String>),
    Network,
    Refused(String),
}

/// `u`'s route: a file under the document root, the network, or a refusal.
pub fn route(u: &url::Url) -> Route {
    let page = page();
    let own = u.scheme() == "file" || (matches!(u.scheme(), "http" | "https") && u.origin() == page.origin());
    if !own {
        return if matches!(u.scheme(), "http" | "https") { Route::Network } else { Route::Refused(format!("fetch {u}: unsupported scheme")) };
    }
    let Some(root) = root() else { return Route::File(Err(format!("fetch {u}: no document root (set {})", crate::config::var_name("FETCH_ROOT")))) };
    let under = |u: &url::Url| -> Result<PathBuf, String> {
        // The URL parser removed dot segments, so the path stays under the root.
        let decoded = percent_decode(u.path()).ok_or_else(|| format!("fetch {u}: invalid path encoding"))?;
        Ok(root.join(decoded.trim_start_matches('/')))
    };
    let path = match u.scheme() {
        // A file: page (the native window's) has no server: its root-relative URLs name files under the root.
        "file" => match u.to_file_path() {
            Ok(p) if p.starts_with(&root) => Ok(p),
            // A file beside the page that is not there (a stylesheet's own relative URL, such as the bare `@import
            // 'pkg/x.css'` a browser resolves beside the sheet: client_stylesheets.rs links the package's sheet itself)
            // is simply missing: it is no root-relative URL, so it never streams (its path would name this machine's
            // folders to the asset base).
            Ok(p) if !crate::is_file(&p) && crate::dom::page_path().and_then(|page| page.parent().map(Path::to_path_buf)).is_some_and(|dir| p.starts_with(dir)) => {
                return Route::File(Err(format!("fetch {u}: no such file beside the page")));
            }
            // A root-relative URL in a file: stylesheet keeps the sheet's drive on Windows (file:///C:/app/x for
            // /app/x): the drive is not part of the root-relative path.
            _ => {
                let mut bare = u.clone();
                let path = u.path();
                let b = path.as_bytes();
                if b.len() >= 3 && b[0] == b'/' && b[1].is_ascii_alphabetic() && b[2] == b':' {
                    bare.set_path(&path[3..]);
                }
                under(&bare)
            }
        },
        _ => under(u),
    };
    // An encoded separator can still spell a parent step (a%2F..%2F..).
    Route::File(path.and_then(|p| {
        if !p.starts_with(&root) || p.components().any(|c| c == Component::ParentDir) {
            Err(format!("fetch {u}: outside the document root"))
        } else {
            Ok(p)
        }
    }))
}

/// The remote URL a page-origin file streams from when it is neither on disk nor carried (a layer's carried files): files only (a
/// last segment with an extension; an API path such as /api/cap is not an asset) and only when a remote asset base or
/// site is set (net.rs `remote_for`: the asset base's prefixes from it, the rest from the site).
pub fn streamed(u: &url::Url, path: &Path) -> Option<url::Url> {
    let is_file = u.path_segments().and_then(|mut s| s.next_back()).is_some_and(|last| last.contains('.'));
    if !is_file || crate::is_file(path) {
        return None;
    }
    net::remote_for(&root()?, path, u.query())
}

/// A streamed file's reply.
///
/// - stale-if-error (RFC 5861): when the network fails (or the server answers 5xx), a copy the HTTP cache holds
///   answers, however stale. The site serves its files `max-age=0, must-revalidate`, so each launch revalidates them;
///   offline, the last copy is the file.
/// - An HTML page answering a path that names no HTML file is a site's fallback for a file it does not have (a
///   single-page app's index.html, with 200): it reads as the 404 it stands for, never as the file.
pub fn streamed_reply(method: &str, remote_url: &url::Url, headers: &[(String, String)], cache: &str) -> Result<Reply, String> {
    let mut r = match remote(method, remote_url.as_str(), headers, Vec::new(), cache) {
        Ok(r) if r.status < 500 => r,
        failed => match remote(method, remote_url.as_str(), headers, Vec::new(), "only-if-cached") {
            Ok(kept) if (200..300).contains(&kept.status) => {
                if crate::config::var_os("NET_TRACE").is_some() {
                    let why = failed.as_ref().map_or_else(|e| e.clone(), |r| format!("{} {}", r.status, r.status_text));
                    eprintln!("net: {}: {why}; the cached copy answers", net::redact(remote_url.as_str()));
                }
                kept
            }
            _ => failed?,
        },
    };
    let html = r.headers.lines().filter_map(|l| l.split_once(':')).any(|(n, v)| n.trim().eq_ignore_ascii_case("content-type") && v.trim().to_ascii_lowercase().starts_with("text/html"));
    let names_html = remote_url.path().rsplit('/').next().is_some_and(|last| last.ends_with(".html") || last.ends_with(".htm"));
    if (200..300).contains(&r.status) && html && !names_html {
        if crate::config::var_os("NET_TRACE").is_some() {
            eprintln!("net: {}: an HTML page for a file the site does not have: 404", net::redact(remote_url.as_str()));
        }
        r.status = 404;
        r.status_text = "Not Found".into();
        r.headers = String::new();
        r.body = Vec::new();
    }
    Ok(r)
}

pub fn header_lines(headers: &[(String, String)]) -> String {
    headers.iter().map(|(n, v)| format!("{n}: {v}")).collect::<Vec<_>>().join("\n")
}

/// A request over the network (net.rs: the shared client, its cache and cookie jar).
pub fn remote(method: &str, url: &str, headers: &[(String, String)], body: Vec<u8>, cache: &str) -> Result<Reply, String> {
    let r = net::request(method, url, headers, body, net::cache_mode(cache))?;
    Ok(Reply { status: r.status, status_text: r.status_text, url: r.url, headers: header_lines(&r.headers), body: r.body })
}

/// One request carried in full: a page-origin API path goes to the API origin ([`api_url`]); another page-origin GET
/// or HEAD reads its file (streamed from the remote asset base when it is missing there), other methods of the page's
/// origin answer 404 (natively there is no server behind those paths), and anything else goes over the network.
pub fn carry(method: &str, u: &url::Url, headers: &[(String, String)], body: Vec<u8>, cache: &str) -> Result<Reply, String> {
    if std::env::var_os("WASM_HOST_TRACE_FETCH").is_some() {
        eprintln!("http {method} {}", net::redact(u.as_str()));
    }
    // data: and blob: URLs answer from memory, as a browser's fetch does, whatever the host's network: a data: URL with
    // any method, its media type as Content-Type (text/plain;charset=US-ASCII when it names none); a live object URL
    // for a GET, its blob's type as Content-Type.
    match u.scheme() {
        "data" => {
            let body = data_url(u).ok_or_else(|| format!("fetch {u}: an invalid data: URL"))?;
            let meta = u.path().split_once(',').map_or("", |(meta, _)| meta);
            let kind = meta.strip_suffix(";base64").unwrap_or(meta).trim();
            let kind = if kind.is_empty() || kind.starts_with(';') { format!("text/plain{}", if kind.is_empty() { ";charset=US-ASCII" } else { kind }) } else { kind.to_string() };
            let body = if method == "HEAD" { Vec::new() } else { body };
            return Ok(Reply { status: 200, status_text: "OK".into(), url: u.to_string(), headers: format!("content-type: {kind}"), body });
        }
        "blob" => {
            if method != "GET" {
                return Err(format!("fetch {u}: a blob: URL answers GET only"));
            }
            let (bytes, kind) = crate::streams::object_url(u.as_str()).ok_or_else(|| format!("fetch {u}: a revoked or unknown object URL"))?;
            let headers = if kind.is_empty() { format!("content-length: {}", bytes.len()) } else { format!("content-type: {kind}\ncontent-length: {}", bytes.len()) };
            return Ok(Reply { status: 200, status_text: "OK".into(), url: u.to_string(), headers, body: bytes.as_ref().clone() });
        }
        _ => {}
    }
    if let Some(api) = api_url(u) {
        return remote(method, api.as_str(), headers, body, cache);
    }
    match route(u) {
        Route::Refused(message) => Err(message),
        Route::Network => remote(method, u.as_str(), headers, body, cache),
        Route::File(path) => {
            let not_found = || Reply { status: 404, status_text: "Not Found".into(), url: u.to_string(), headers: String::new(), body: Vec::new() };
            if !matches!(method, "GET" | "HEAD") {
                return Ok(not_found());
            }
            let path = path?;
            if let Some(remote_url) = streamed(u, &path) {
                return streamed_reply(method, &remote_url, headers, cache);
            }
            match crate::read(&path) {
                Ok(bytes) => {
                    let body = if method == "HEAD" { Vec::new() } else { bytes };
                    Ok(Reply { status: 200, status_text: "OK".into(), url: u.to_string(), headers: format!("content-length: {}", body.len()), body })
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound || path.is_dir() => Ok(not_found()),
                Err(e) => Err(format!("fetch {u}: {e}")),
            }
        }
    }
}

/// A new pending promise the request holds until it settles.
pub fn held_promise() -> (Value, u64) {
    let promise = values::new_promise();
    let Value::Object(r) = promise else { unreachable!() };
    objects::retain(r);
    (promise, r)
}

/* ── the page's fetch() ───────────────────────────────────────────── */

/// A Response read in full.
pub struct FetchResponse {
    status: u16,
    status_text: String,
    url: String,
    pub headers: std::rc::Rc<Vec<(String, String)>>,
    /// Taken by the first body read (a stream's transform may still be running on a worker: streams.rs).
    body: RefCell<Option<crate::streams::BodyBytes>>,
}

impl FetchResponse {
    /// `new Response(body)`: a 200 with those bytes and no headers.
    #[allow(dead_code)]
    pub fn from_body(body: Vec<u8>) -> FetchResponse {
        Self::from_body_bytes(crate::streams::BodyBytes::Ready(body))
    }

    /// `new Response(stream)` whose stream's transform (a DecompressionStream's gunzip) may still be running on a
    /// worker thread: its body read settles when the bytes arrive, so the page thread never waits for it.
    pub fn from_body_bytes(body: crate::streams::BodyBytes) -> FetchResponse {
        FetchResponse { status: 200, status_text: String::new(), url: String::new(), headers: std::rc::Rc::new(Vec::new()), body: RefCell::new(Some(body)) }
    }
}

/// `fetch(input, init)`: a promise of the Response (a network failure rejects with a TypeError, any status resolves).
pub fn fetch_global(args: &[Value]) -> Value {
    let input = args.first().cloned().unwrap_or(Value::Undefined);
    let raw = objects::url_href(&input).unwrap_or_else(|| objects::to_display(&input));
    let init = match args.get(1) {
        Some(Value::Object(r)) => Some(*r),
        _ => None,
    };
    let field = |name: &str| init.and_then(|r| objects::get(r, name).ok()).filter(|v| !matches!(v, Value::Undefined | Value::Null));
    let method = field("method").map(|v| objects::to_display(&v).to_ascii_uppercase()).unwrap_or_else(|| "GET".into());
    let cache = field("cache").map(|v| objects::to_display(&v)).unwrap_or_else(|| "default".into());
    let headers: Vec<(String, String)> = match field("headers") {
        Some(h) => match objects::headers_of(&h) {
            Some(pairs) => pairs.as_ref().clone(),
            None => match h {
                Value::Object(r) => values::own_keys(r).into_iter().filter_map(|k| objects::get(r, &k).ok().map(|v| (k, objects::to_display(&v)))).collect(),
                _ => Vec::new(),
            },
        },
        None => Vec::new(),
    };
    let body = match field("body") {
        Some(Value::Str(s)) => s.into_bytes(),
        Some(Value::Object(r)) => values::bytes_of(r).map(|(_, data)| data).unwrap_or_default(),
        _ => Vec::new(),
    };
    // An AbortSignal: an aborted one rejects at once; else its abort rejects this fetch (abort.rs).
    let signal = match field("signal") {
        Some(Value::Object(s)) => objects::abort_signal_of(s),
        _ => None,
    };
    if let Some(s) = &signal
        && s.aborted()
    {
        let promise = values::new_promise();
        if let Value::Object(p) = promise {
            values::settle(p, true, &s.reason());
        }
        return promise;
    }
    let (promise, r) = held_promise();
    if let Some(s) = &signal {
        s.watch(r);
    }
    let resolved = page().join(&raw);
    submit_net(Box::new(move || {
        let reply = match resolved {
            Ok(u) => carry(&method, &u, &headers, body, &cache),
            Err(e) => Err(format!("fetch {raw}: invalid URL ({e})")),
        };
        // fetch's own message for a network failure; the reason is the trace's.
        let reply = reply.map_err(|reason| {
            if std::env::var_os("WASM_HOST_TRACE_FETCH").is_some() {
                eprintln!("fetch failed: {reason}");
            }
            "Failed to fetch".to_string()
        });
        Done::Fetch { promise: r, reply }
    }));
    promise
}

/// A Response's field.
pub fn response_get(r: &FetchResponse, name: &str) -> Option<Value> {
    Some(match name {
        "status" => Value::Number(f64::from(r.status)),
        "ok" => Value::Bool((200..300).contains(&r.status)),
        "statusText" => Value::Str(r.status_text.clone()),
        "url" => Value::Str(r.url.clone()),
        "redirected" => Value::Bool(false),
        "type" => Value::Str("basic".into()),
        "bodyUsed" => Value::Bool(r.body.borrow().is_none()),
        _ => return None,
    })
}

/// A Response's body read (once): text, json, arrayBuffer / bytes, each a promise.
pub fn response_call(r: &FetchResponse, name: &str) -> Result<Value, String> {
    if !matches!(name, "text" | "json" | "arrayBuffer" | "bytes") {
        return Err(format!("Response.{name} is not a function"));
    }
    let Some(body) = r.body.borrow_mut().take() else {
        return Ok(rejected("TypeError", &format!("Failed to execute '{name}' on 'Response': body stream already read")));
    };
    let (promise, p) = held_promise();
    let name = name.to_string();
    // At once when the bytes are here (as before); else once the worker's transform ended, on a later turn.
    body.then(move |bytes| {
        let answer: Result<Value, (String, String)> = bytes.map_err(|m| ("TypeError".to_string(), m)).and_then(|bytes| match name.as_str() {
            "text" => Ok(Value::Str(String::from_utf8_lossy(&bytes).into_owned())),
            "json" => values::json_parse(&[Value::Str(String::from_utf8_lossy(&bytes).into_owned())]).map_err(|(message, error)| (error.to_string(), message)),
            _ => Ok(values::new_bytes(values::U8, bytes)),
        });
        match answer {
            Ok(v) => values::settle(p, false, &v),
            Err((error, message)) => values::settle(p, true, &values::new_error(&error, &message)),
        }
        objects::release(p);
    });
    Ok(promise)
}

/* ── the runtime's fetch (scr_fetch.c's host transport) ────────────── */

type Settle = unsafe extern "C" fn(*mut c_void, i32, *const u8, usize, *const u8, usize, *const u8, usize, *const u8, usize);
type Fail = unsafe extern "C" fn(*mut c_void, *const u8, usize);

/// `ScrFetchHostTransport`.
#[repr(C)]
pub struct FetchTransport {
    start: unsafe extern "C" fn(*mut c_void, *const u8, usize, *const u8, usize, *const u8, usize, *const u8, usize),
}

static TRANSPORT: FetchTransport = FetchTransport { start: transport_start };
static ANSWER: OnceLock<(Settle, Fail)> = OnceLock::new();

/// The runtime asks for the host's transport when a program uses fetch (scr_fetch_install), handing over the
/// functions that answer a transfer.
#[unsafe(no_mangle)]
pub extern "C" fn scr_host_fetch_transport(settle: Settle, fail: Fail) -> *const FetchTransport {
    let _ = ANSWER.set((settle, fail));
    &TRANSPORT
}

/// # Safety
/// Each pointer names `len` readable bytes for the call (the runtime's strings and body).
unsafe fn copied(data: *const u8, len: usize) -> Vec<u8> {
    if len == 0 || data.is_null() { Vec::new() } else { unsafe { std::slice::from_raw_parts(data, len) }.to_vec() }
}

#[allow(clippy::too_many_arguments)]
unsafe extern "C" fn transport_start(token: *mut c_void, method: *const u8, method_len: usize, url: *const u8, url_len: usize,
    headers: *const u8, headers_len: usize, body: *const u8, body_len: usize) {
    // SAFETY: the runtime passes each span with its length, valid for this call; everything is copied now.
    let (method, url, headers, body) = unsafe {
        (copied(method, method_len), copied(url, url_len), copied(headers, headers_len), copied(body, body_len))
    };
    let method = String::from_utf8_lossy(&method).to_ascii_uppercase();
    let url = String::from_utf8_lossy(&url).into_owned();
    // No Accept-Encoding goes out (the host asks for none), so every body comes back as sent: the Response is
    // handed it decoded, as a page's fetch hands it.
    let headers: Vec<(String, String)> = String::from_utf8_lossy(&headers)
        .lines()
        .filter_map(|l| l.split_once(':').map(|(n, v)| (n.trim().to_string(), v.trim().to_string())))
        .filter(|(n, _)| !n.is_empty() && !n.eq_ignore_ascii_case("accept-encoding"))
        .collect();
    let token = token as usize;
    submit_net(Box::new(move || {
        // The runtime serialized an absolute URL; a relative one (none should be) resolves against the page.
        let reply = match page().join(&url) {
            Ok(u) => carry(&method, &u, &headers, body, "default"),
            Err(e) => Err(format!("fetch {url}: invalid URL ({e})")),
        };
        Done::Transfer { token, reply }
    }));
}

fn answer_transfer(token: *mut c_void, reply: Result<Reply, String>) {
    let Some(&(settle, fail)) = ANSWER.get() else { return };
    // SAFETY: the token is the runtime's live transfer (it holds it until this answer), and every span is ours for
    // the call's duration.
    unsafe {
        match reply {
            Ok(r) => settle(token, i32::from(r.status), r.status_text.as_ptr(), r.status_text.len(), r.url.as_ptr(), r.url.len(),
                r.headers.as_ptr(), r.headers.len(), r.body.as_ptr(), r.body.len()),
            Err(message) => fail(token, message.as_ptr(), message.len()),
        }
    }
}

pub fn rejected(name: &str, message: &str) -> Value {
    let promise = values::new_promise();
    let Value::Object(r) = promise else { unreachable!() };
    values::settle(r, true, &values::new_error(name, message));
    promise
}

pub fn resolved(value: Value) -> Value {
    let promise = values::new_promise();
    let Value::Object(r) = promise else { unreachable!() };
    values::settle(r, false, &value);
    promise
}

/// A host module's function: the layer's first, then the host's own.
pub fn call(module: &str, name: &str, args: &[Value]) -> Result<Value, Failure> {
    if let Some(answer) = crate::layer::get().module_call(module, name, args) {
        return answer;
    }
    match (module, name) {
        // The runtime asks for a page module it could not compile (scr_host_island.c scr_jsval_import): a worker
        // piece's constructor for a `?worker` import (workers.rs), else undefined (not supplied).
        ("scriptc:page-import", "import") => Ok(crate::workers::page_import(args)),
        _ => Err(Failure::Message(format!("{module}: '{name}' has no native implementation in the host island"))),
    }
}
