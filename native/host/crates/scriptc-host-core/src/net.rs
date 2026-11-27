//! The host's network layer: one async runtime and one HTTP client for everything the host sends, as a browser has
//! one network stack under fetch, `<img>` and WebSocket.
//!
//! - **The client** is reqwest (rustls, the platform's certificate verifier) under reqwest-middleware with
//!   http-cache-reqwest: an RFC 9111 cache (freshness from Cache-Control and Expires, revalidation with ETag /
//!   Last-Modified, `no-store` honoured), kept on disk by cacache (content-addressed, integrity-checked) in the
//!   platform's cache directory ([`cache_dir`]). It is a private cache, as a browser's is (`private` responses are
//!   kept); a page's `cache` option (`no-store`, `reload`, `force-cache`, ...) maps to the cache's per-request mode
//!   ([`cache_mode`]).
//! - **Cookies**: one jar for the process, as a browser profile has, held in memory.
//! - **The runtime** is a small multi-threaded tokio runtime. Callers on the host's own worker threads block on it
//!   ([`request`]).
//! - **What an embedder adds** (its [`Layer`](crate::layer::Layer)): the user agent, a cache key (the method and URL by
//!   default), [`redact`] for traces and errors, the URLs a redirect may not leave, its own middleware (innermost,
//!   below the cache: only what reaches the network passes it), and [`remote_for`], where a file missing from the
//!   document root streams from.
//!
//! `<PREFIX>HTTP_CACHE=<dir>` moves the cache; `<PREFIX>HTTP_CACHE=off` sends every request to the network.
//! `<PREFIX>NET_TRACE=1` names each request with its status and whether the cache answered (the prefix: config.rs).

use std::path::PathBuf;
#[cfg(feature = "net")]
use std::sync::OnceLock;

#[cfg(feature = "net")]
use http_cache_reqwest::{CACacheManager, Cache, CacheMode, CacheOptions, HttpCache, HttpCacheOptions};
#[cfg(feature = "net")]
use reqwest_middleware::{ClientBuilder, ClientWithMiddleware};

/// A request's cache mode in a host built without the network (no `net` feature): fetch's names, kept so the
/// callers read the same; no request is made.
#[cfg(not(feature = "net"))]
#[derive(Clone, Copy, Debug)]
pub enum CacheMode {
    Default,
    NoStore,
    Reload,
    NoCache,
    ForceCache,
    OnlyIfCached,
}

/// A response read in full.
pub struct Response {
    pub status: u16,
    pub status_text: String,
    /// The final URL (after redirects).
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

/// The runtime every network task runs on.
#[cfg(feature = "net")]
pub fn runtime() -> &'static tokio::runtime::Runtime {
    static RUNTIME: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
    RUNTIME.get_or_init(|| {
        // Four: with dozens of requests in flight, the cache's writes and integrity hashes (cacache) run here too.
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(4)
            .thread_name(crate::config::thread_name("net"))
            .enable_all()
            .build()
            .expect("net: start the network runtime")
    })
}

/// Where the HTTP cache lives: <PREFIX>HTTP_CACHE, else the platform's cache directory for the app (Android: the
/// app's files directory, which is HOME there).
pub fn cache_dir() -> PathBuf {
    if let Some(dir) = crate::config::var_os("HTTP_CACHE") {
        return PathBuf::from(dir);
    }
    let app = crate::config::get().app_name;
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
    if cfg!(target_os = "macos") {
        home.join("Library/Caches").join(app).join("http")
    } else if cfg!(target_os = "windows") {
        std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or(home).join(app).join("cache/http")
    } else if cfg!(target_os = "android") {
        home.join("cache/http")
    } else {
        std::env::var_os("XDG_CACHE_HOME").map(PathBuf::from).unwrap_or_else(|| home.join(".cache")).join(app.to_lowercase()).join("http")
    }
}

/// The process's HTTP client (cached, with the cookie jar).
#[cfg(feature = "net")]
pub fn client() -> &'static ClientWithMiddleware {
    static CLIENT: OnceLock<ClientWithMiddleware> = OnceLock::new();
    CLIENT.get_or_init(|| {
        let layer = crate::layer::get();
        let inner = reqwest::Client::builder()
            .cookie_store(true)
            .user_agent(layer.net_user_agent())
            .redirect(redirect_policy())
            .build()
            .expect("net: build the HTTP client");
        let builder = ClientBuilder::new(inner);
        if crate::config::var("HTTP_CACHE").as_deref() == Ok("off") {
            return layer.net_middleware(builder).build();
        }
        // The cache first, the layer's middleware below it: only what goes to the network passes it.
        layer
            .net_middleware(builder.with(Cache(HttpCache {
                mode: CacheMode::Default,
                manager: CACacheManager::new(cache_dir(), true),
                options: HttpCacheOptions {
                    cache_key: Some(std::sync::Arc::new(|parts: &http::request::Parts| crate::layer::get().net_cache_key(parts.method.as_str(), &parts.uri.to_string()))),
                    // A private cache, as a browser's is: one user's, so a `private` response is kept too.
                    cache_options: Some(CacheOptions { shared: false, ..CacheOptions::default() }),
                    ..HttpCacheOptions::default()
                },
            })))
            .build()
    })
}

/// reqwest's default policy (at most 10 hops), except that a redirect from inside the layer's scope
/// ([`Layer::net_in_scope`](crate::layer::Layer::net_in_scope)) to a URL outside it is not followed (the response is the
/// redirect): headers the layer adds for its scope would go along with it.
#[cfg(feature = "net")]
fn redirect_policy() -> reqwest::redirect::Policy {
    reqwest::redirect::Policy::custom(|attempt| {
        if attempt.previous().len() > 10 {
            return attempt.error("too many redirects");
        }
        let layer = crate::layer::get();
        let from_scope = attempt.previous().first().is_some_and(|u| layer.net_in_scope(u));
        if from_scope && !layer.net_in_scope(attempt.url()) {
            if crate::config::var_os("NET_TRACE").is_some() {
                eprintln!("net: not following a redirect out of the asset base to {}", redact(attempt.url().as_str()));
            }
            return attempt.stop();
        }
        attempt.follow()
    })
}

/// A page's `RequestInit.cache` as the cache's per-request mode (fetch's names; unknown ones are `default`).
pub fn cache_mode(cache: &str) -> CacheMode {
    match cache {
        "no-store" => CacheMode::NoStore,
        "reload" => CacheMode::Reload,
        "no-cache" => CacheMode::NoCache,
        "force-cache" => CacheMode::ForceCache,
        "only-if-cached" => CacheMode::OnlyIfCached,
        _ => CacheMode::Default,
    }
}

/// `text` with what the layer keeps out of logs replaced (traces and error messages reach logs and logcat).
pub fn redact(text: &str) -> String {
    crate::layer::get().net_redact(text)
}

/// The remote URL for a file under the document root (`path`, already resolved and inside `root`) when it is not on
/// disk: the layer's ([`Layer::remote_for`](crate::layer::Layer::remote_for)); none by default.
pub fn remote_for(root: &std::path::Path, path: &std::path::Path, query: Option<&str>) -> Option<url::Url> {
    if path.is_file() {
        return None;
    }
    crate::layer::get().remote_for(root, path, query)
}

/// One request, read in full. Blocks the calling thread (a host worker, never a runtime thread).
#[cfg(feature = "net")]
pub fn request(method: &str, url: &str, headers: &[(String, String)], body: Vec<u8>, cache: CacheMode) -> Result<Response, String> {
    let fail = |e: &dyn std::fmt::Display| redact(&format!("fetch {url}: {e}"));
    let method = reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| fail(&e))?;
    // A GET or HEAD that failed on the way (a connection error, a timeout) or that the CDN answered 502, 503 or 504 (a
    // gateway that timed out reading storage) is tried again, twice, after 300 ms and 1.2 s: a texture lost to one
    // timeout otherwise stays missing for the session.
    let idempotent = method == reqwest::Method::GET || method == reqwest::Method::HEAD;
    // For the trace: when the request started (wall clock, ms) and how long its headers and its body took.
    let started = std::time::Instant::now();
    let started_at = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis());
    runtime().block_on(async {
        let mut attempt = 0u32;
        let response = loop {
            let mut builder = client().request(method.clone(), url).with_extension(cache);
            for (name, value) in headers {
                builder = builder.header(name, value);
            }
            if !body.is_empty() {
                builder = builder.body(body.clone());
            }
            let sent = builder.send().await;
            let retry = idempotent && attempt < 2 && sent.as_ref().map_or(true, |r| matches!(r.status().as_u16(), 502..=504));
            if !retry {
                break sent.map_err(|e| fail(&e))?;
            }
            attempt += 1;
            if crate::config::var_os("NET_TRACE").is_some() {
                let why = sent.as_ref().map_or_else(|e| redact(&e.to_string()), |r| r.status().as_u16().to_string());
                eprintln!("net: retrying {} ({why}), attempt {}", redact(url), attempt + 1);
            }
            tokio::time::sleep(std::time::Duration::from_millis(if attempt == 1 { 300 } else { 1200 })).await;
        };
        let status = response.status();
        let final_url = response.url().to_string();
        let headers: Vec<(String, String)> = response.headers().iter().map(|(n, v)| (n.as_str().to_string(), String::from_utf8_lossy(v.as_bytes()).into_owned())).collect();
        let headers_ms = started.elapsed().as_millis();
        let body = response.bytes().await.map_err(|e| fail(&e))?.to_vec();
        if crate::config::var_os("NET_TRACE").is_some() {
            // http-cache marks what it answered (x-cache: HIT / MISS, x-cache-lookup). Then the start (Unix ms), the
            // time to the headers and in all (ms), and the body's size.
            let cache = headers.iter().find(|(n, _)| n == "x-cache").map_or("-", |(_, v)| v.as_str());
            eprintln!(
                "net: {} {} -> {} (cache {cache}) at {started_at} headers {headers_ms} total {} bytes {}",
                status.as_u16(),
                redact(url),
                redact(&final_url),
                started.elapsed().as_millis(),
                body.len()
            );
        }
        Ok(Response { status: status.as_u16(), status_text: status.canonical_reason().unwrap_or("").into(), url: final_url, headers, body })
    })
}

/// A host built without the network (no `net` feature): every request fails as it does offline, naming why.
#[cfg(not(feature = "net"))]
pub fn request(_method: &str, url: &str, _headers: &[(String, String)], _body: Vec<u8>, _cache: CacheMode) -> Result<Response, String> {
    Err(redact(&format!("fetch {url}: this host was built without the network (its `net` feature)")))
}
