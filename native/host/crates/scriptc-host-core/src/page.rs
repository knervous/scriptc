//! The window's plain objects natively, answered, as a browser answerss them (the reference):
//! `location`, `history`, `navigator`, `screen`, `localStorage` / `sessionStorage`, `matchMedia(query)`, and the
//! window's own numbers (`innerWidth`, `devicePixelRatio`, ...).
//!
//! - `location`: the session history's current entry, at first the page URL (modules.rs `page`: `<PREFIX>PAGE_URL`,
//!   else `http://localhost/`); `history.pushState` / `replaceState` move it within the origin, `back` / `forward` /
//!   `go` step through the entries and owe the window a `popstate` (the event loop's next turn); `reload()`, or
//!   `assign` / `replace` to the page's own address, starts the program afresh (window.rs `reload`: Windows), and a
//!   navigation anywhere else does nothing (there is one page).
//! - `localStorage`: a file loaded on first use and written on each change (`<PREFIX>LOCAL_STORAGE` names it; empty
//!   keeps it in memory), by default `local-storage.tsv` in the app's folder (config.rs `app_dir`; the
//!   format: one `key\tvalue` line each, escaped). `sessionStorage` lives as long as the page, and a reload's start
//!   is handed it (`<PREFIX>SESSION_STORAGE`).
//! - `matchMedia(q)`: a MediaQueryList whose `matches` evaluates the device's features (a desktop: a fine pointer that
//!   hovers; `<PREFIX>TOUCH_POINTS` > 0: a coarse one that does not), a light scheme, no reduced motion, and the
//!   viewport in CSS pixels; change listeners never fire.

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::path::PathBuf;

use crate::objects::{self, Value};

/// One of the page's objects (objects.rs `Kind::Page`).
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum PageObj {
    Location,
    History,
    Navigator,
    Screen,
    /// true: localStorage, false: sessionStorage.
    Storage(bool),
    MediaQuery(u32),
    /// `window.crypto`: randomUUID().
    Crypto,
    /// `navigator.storage`: the origin private file system (opfs.rs).
    StorageManager,
    /// `window.visualViewport`: the viewport as the window has it (no pinch zoom natively).
    VisualViewport,
    /// `navigator.keyboard`: the Keyboard Lock API (dom.rs keeps the lock; Escape's is the one that matters).
    Keyboard,
    /// `navigator.clipboard`: readText() and writeText() on the system's clipboard (dom.rs clipboard.rs).
    Clipboard,
    /// `navigator.wakeLock`: request('screen') keeps the screen on (Android: FLAG_KEEP_SCREEN_ON) until the sentinel
    /// it answers is released. One lock.
    WakeLock,
    /// The `WakeLockSentinel` request answers: release(), and the `release` listener a browser calls when it drops the
    /// lock itself (never natively: the lock goes only when released).
    WakeLockSentinel,
}

thread_local! {
    /// Whether the page holds the screen wake lock (navigator.wakeLock).
    static WAKE_LOCK: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// The touch points the device reports (`navigator.maxTouchPoints`), <PREFIX>TOUCH_POINTS, else 0 on
/// a desktop and 5 on Android.
pub fn touch_points() -> u32 {
    static POINTS: std::sync::OnceLock<u32> = std::sync::OnceLock::new();
    *POINTS.get_or_init(|| {
        crate::config::var("TOUCH_POINTS").ok().and_then(|v| v.parse().ok()).unwrap_or(if cfg!(target_os = "android") { 5 } else { 0 })
    })
}

#[derive(Default)]
struct Storage {
    entries: BTreeMap<String, String>,
    file: Option<PathBuf>,
    loaded: bool,
}

impl Storage {
    fn at(file: Option<PathBuf>) -> Storage {
        Storage { entries: BTreeMap::new(), file, loaded: false }
    }
    fn load(&mut self) {
        if std::mem::replace(&mut self.loaded, true) {
            return;
        }
        let Some(text) = self.file.as_ref().and_then(|f| std::fs::read_to_string(f).ok()) else { return };
        self.read(&text);
    }
    fn read(&mut self, text: &str) {
        for line in text.lines() {
            if let Some((k, v)) = line.split_once('\t') {
                self.entries.insert(unescape(k), unescape(v));
            }
        }
    }
    fn text(&self) -> String {
        self.entries.iter().map(|(k, v)| format!("{}\t{}\n", escape(k), escape(v))).collect()
    }
    fn save(&self) {
        let Some(file) = &self.file else { return };
        let text = self.text();
        if let Some(dir) = file.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let tmp = file.with_extension("tmp");
        if std::fs::write(&tmp, text).is_ok() {
            let _ = std::fs::rename(&tmp, file);
        }
    }
    fn entries(&mut self) -> &mut BTreeMap<String, String> {
        self.load();
        &mut self.entries
    }
}

fn escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('\t', "\\t").replace('\n', "\\n").replace('\r', "\\r")
}

fn unescape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut it = s.chars();
    while let Some(c) = it.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match it.next() {
            Some('t') => out.push('\t'),
            Some('n') => out.push('\n'),
            Some('r') => out.push('\r'),
            Some(other) => out.push(other),
            None => out.push('\\'),
        }
    }
    out
}

struct Page {
    queries: Vec<String>,
    /// The session history: its entries' URLs and the current one, once the page navigated within itself (before
    /// that, the page's own URL is the only entry).
    history: Vec<url::Url>,
    history_at: usize,
    /// `popstate` events back/forward/go owe the window.
    popstate: u32,
}

impl Default for Page {
    fn default() -> Page {
        Page { queries: Vec::new(), history: Vec::new(), history_at: 0, popstate: 0 }
    }
}

/// localStorage and sessionStorage, one of each per process: the main thread's page reads and writes them, and so
/// does a render thread through its page hooks (render_thread.rs), so both see one store and one file.
static STORAGES: std::sync::Mutex<Option<(Storage, Storage)>> = std::sync::Mutex::new(None);

fn with_storage<R>(local: bool, f: impl FnOnce(&mut Storage) -> R) -> R {
    let mut stores = STORAGES.lock().unwrap_or_else(|e| e.into_inner());
    let (l, s) = stores.get_or_insert_with(|| {
        let file = match crate::config::var("LOCAL_STORAGE") {
            Ok(p) if p.is_empty() => None,
            Ok(p) => Some(PathBuf::from(p)),
            Err(_) => crate::app_dir().map(|d| d.join("local-storage.tsv")),
        };
        // A reload's sessionStorage, as the program that reloaded left it (window.rs `reload`).
        let mut session = Storage::default();
        if let Ok(text) = crate::config::var(SESSION_CARRIED) {
            session.read(&text);
        }
        (Storage::at(file), session)
    });
    f(if local { l } else { s })
}

/// The variable a reload hands its sessionStorage to the next start in (a browser's reload keeps the tab's).
/// (`<PREFIX>SESSION_STORAGE`: config.rs.)
pub const SESSION_CARRIED: &str = "SESSION_STORAGE";

/// sessionStorage as the next start reads it from [`SESSION_CARRIED`].
#[cfg_attr(not(windows), allow(dead_code))]
pub fn session_storage_text() -> String {
    with_storage(false, |s| s.text())
}

/// A stored value (localStorage when `local`, else sessionStorage), or None.
pub fn storage_get(local: bool, key: &str) -> Option<String> {
    with_storage(local, |s| s.entries().get(key).cloned())
}

/// Stores `value` under `key`, or removes the key for None.
pub fn storage_set(local: bool, key: &str, value: Option<String>) {
    with_storage(local, |s| {
        let changed = match value {
            Some(v) => {
                s.entries().insert(key.to_string(), v);
                true
            }
            None => s.entries().remove(key).is_some(),
        };
        if changed {
            s.save();
        }
    })
}

thread_local! {
    static PAGE: RefCell<Page> = RefCell::new(Page::default());
}

/// The current history entry's URL (`location`).
pub fn page_url() -> url::Url {
    PAGE.with(|p| {
        let p = p.borrow();
        p.history.get(p.history_at).cloned()
    })
    .unwrap_or_else(crate::modules::page)
}

/// A fragment handed to the window from outside (another launch's link, launch.rs), owed as a navigation.
static OPENED: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);
static OPENED_OWED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Owes the page a navigation to `fragment` (from any thread): the main thread's next loop turn makes it.
pub fn open_fragment(fragment: String) {
    *OPENED.lock().unwrap_or_else(|e| e.into_inner()) = Some(fragment);
    OPENED_OWED.store(true, std::sync::atomic::Ordering::Release);
    crate::window::wake();
}

/// A navigation to an opened fragment is owed (main thread only).
pub fn fragment_owed() -> bool {
    crate::render_thread::is_main_thread() && OPENED_OWED.load(std::sync::atomic::Ordering::Acquire)
}

/// The owed navigation, as a fragment navigation is: a new history entry at the fragment, then `popstate` and
/// `hashchange` at the window. Nothing when the address already has that fragment.
pub fn deliver_fragment() {
    OPENED_OWED.store(false, std::sync::atomic::Ordering::Release);
    let Some(fragment) = OPENED.lock().unwrap_or_else(|e| e.into_inner()).take() else { return };
    let current = page_url();
    let mut next = current.clone();
    next.set_fragment(Some(&fragment));
    if next == current {
        return;
    }
    PAGE.with(|p| {
        let mut p = p.borrow_mut();
        if p.history.is_empty() {
            p.history.push(current);
            p.history_at = 0;
        }
        let at = p.history_at;
        p.history.truncate(at + 1);
        p.history.push(next);
        p.history_at = p.history.len() - 1;
    });
    crate::dom::fire_window_event("popstate");
    crate::dom::fire_window_event("hashchange");
}

/// history.back/forward/go owe the window a `popstate` (the loop's next turn dispatches it).
pub fn popstate_owed() -> bool {
    PAGE.with(|p| p.borrow().popstate > 0)
}

pub fn deliver_popstate() {
    let owed = PAGE.with(|p| std::mem::take(&mut p.borrow_mut().popstate));
    for _ in 0..owed {
        crate::dom::fire_window_event("popstate");
    }
}

/// The window members that are these objects.
pub fn window_object(name: &str) -> Option<PageObj> {
    Some(match name {
        "location" => PageObj::Location,
        "history" => PageObj::History,
        "navigator" => PageObj::Navigator,
        "screen" => PageObj::Screen,
        "localStorage" => PageObj::Storage(true),
        "crypto" => PageObj::Crypto,
        "sessionStorage" => PageObj::Storage(false),
        "visualViewport" => PageObj::VisualViewport,
        _ => return None,
    })
}

/// The viewport in CSS pixels.
fn viewport() -> (f64, f64) {
    crate::dom::with_document_quiet(|doc| {
        let v = doc.viewport();
        let scale = (v.hidpi_scale * v.zoom).max(0.01) as f64;
        (v.window_size.0 as f64 / scale, v.window_size.1 as f64 / scale)
    })
}

/// The window's own numbers and flags (None: not one of them).
pub fn window_get(name: &str) -> Option<Value> {
    let num = |n: f64| Some(Value::Number(n));
    match name {
        "innerWidth" | "outerWidth" => num(viewport().0),
        "innerHeight" | "outerHeight" => num(viewport().1),
        "devicePixelRatio" => num(crate::dom::with_document_quiet(|doc| {
            let v = doc.viewport();
            (v.hidpi_scale * v.zoom) as f64
        })),
        "scrollX" | "pageXOffset" => num(crate::dom::with_document_quiet(|doc| doc.viewport_scroll().x)),
        "scrollY" | "pageYOffset" => num(crate::dom::with_document_quiet(|doc| doc.viewport_scroll().y)),
        "screenX" | "screenY" | "screenLeft" | "screenTop" => num(0.0),
        // A touch device's window has the touch handlers (`'ontouchstart' in window`), a desktop's does not.
        "ontouchstart" | "ontouchend" | "ontouchmove" | "ontouchcancel" if touch_points() > 0 => Some(Value::Null),
        // Shared memory and threads are the native host's own (what cross-origin isolation grants a page).
        "crossOriginIsolated" | "isSecureContext" => Some(Value::Bool(true)),
        _ => None,
    }
}

pub fn is_window_method(name: &str) -> bool {
    matches!(name, "matchMedia")
}

pub fn window_call(name: &str, args: &[Value]) -> Option<Result<Value, String>> {
    match name {
        "matchMedia" => {
            let query = args.first().map(objects::to_display).unwrap_or_default().trim().to_string();
            let i = PAGE.with(|p| {
                let mut p = p.borrow_mut();
                p.queries.push(query);
                p.queries.len() as u32 - 1
            });
            Some(Ok(objects::page_object(PageObj::MediaQuery(i))))
        }
        _ => None,
    }
}

/// A member read (None: not a member the host has).
pub fn get(h: PageObj, name: &str) -> Option<Value> {
    let num = |n: f64| Some(Value::Number(n));
    let s = |t: &str| Some(Value::Str(t.to_string()));
    match h {
        PageObj::History => match name {
            "length" => num(PAGE.with(|p| p.borrow().history.len().max(1)) as f64),
            // States are not kept natively (a page that passes null).
            "state" => Some(Value::Null),
            "scrollRestoration" => s("auto"),
            _ => None,
        },
        PageObj::Location => {
            let u = page_url();
            let port = u.port().map(|p| p.to_string()).unwrap_or_default();
            match name {
                "href" => s(u.as_str()),
                "origin" => s(&u.origin().ascii_serialization()),
                "protocol" => s(&format!("{}:", u.scheme())),
                "host" => s(&match u.port() { Some(_) => format!("{}:{port}", u.host_str().unwrap_or("")), None => u.host_str().unwrap_or("").to_string() }),
                "hostname" => s(u.host_str().unwrap_or("")),
                "port" => s(&port),
                "pathname" => s(u.path()),
                "search" => s(&u.query().map(|q| format!("?{q}")).unwrap_or_default()),
                "hash" => s(&u.fragment().map(|f| format!("#{f}")).unwrap_or_default()),
                _ => None,
            }
        }
        PageObj::Navigator => match name {
            // The operating system's, as a browser there reports it (a page may tell phones and Macs apart by it), then
            // the store that installed this copy, if one did.
            "userAgent" => s(&format!("Mozilla/5.0 ({}) {}/{}{}", if cfg!(windows) {
                "Windows NT 10.0; Win64; x64"
            } else if cfg!(target_os = "android") {
                "Linux; Android 10; K"
            } else {
                "Macintosh; Intel Mac OS X 10_15_7"
            }, crate::config::get().product, crate::config::get().version, crate::layer::get().user_agent_suffix())),
            "platform" => s(if cfg!(windows) { "Win32" } else if cfg!(target_os = "android") { "Linux armv81" } else { "MacIntel" }),
            "language" => s("en-US"),
            "vendor" => s(""),
            "hardwareConcurrency" => num(std::thread::available_parallelism().map_or(4, |n| n.get()) as f64),
            "maxTouchPoints" => num(touch_points() as f64),
            "onLine" | "cookieEnabled" => Some(Value::Bool(true)),
            "storage" => Some(objects::page_object(PageObj::StorageManager)),
            // The window's (a worker has none).
            "keyboard" if crate::render_thread::is_main_thread() => Some(objects::page_object(PageObj::Keyboard)),
            // The window's (a worker's navigator has none).
            "clipboard" if crate::render_thread::is_main_thread() => Some(objects::page_object(PageObj::Clipboard)),
            // The window's (a worker's navigator has none).
            "wakeLock" if crate::render_thread::is_main_thread() => Some(objects::page_object(PageObj::WakeLock)),
            _ => None,
        },
        PageObj::Screen => {
            let (w, h) = viewport();
            match name {
                "width" | "availWidth" => num(w),
                "height" | "availHeight" => num(h),
                "colorDepth" | "pixelDepth" => num(24.0),
                _ => None,
            }
        }
        PageObj::Storage(local) => match name {
            "length" => num(with_storage(local, |s| s.entries().len()) as f64),
            _ => None,
        },
        PageObj::Crypto | PageObj::StorageManager | PageObj::Keyboard | PageObj::Clipboard | PageObj::WakeLock => None,
        PageObj::WakeLockSentinel => match name {
            "released" => Some(Value::Bool(!WAKE_LOCK.with(|l| l.get()))),
            "type" => s("screen"),
            "onrelease" => Some(Value::Null),
            _ => None,
        },
        PageObj::VisualViewport => {
            let (w, h) = viewport();
            let scroll = crate::dom::with_document_quiet(|doc| doc.viewport_scroll());
            match name {
                "width" => num(w),
                "height" => num(h),
                "scale" => num(1.0),
                "offsetLeft" | "offsetTop" => num(0.0),
                "pageLeft" => num(scroll.x),
                "pageTop" => num(scroll.y),
                "onresize" | "onscroll" | "onscrollend" => Some(Value::Null),
                _ => None,
            }
        }
        PageObj::MediaQuery(i) => {
            let q = PAGE.with(|p| p.borrow().queries.get(i as usize).cloned())?;
            match name {
                "matches" => Some(Value::Bool(media_matches(&q, viewport(), false))),
                "media" => Some(Value::Str(q)),
                // Change handlers never fire.
                "onchange" => Some(Value::Null),
                _ => None,
            }
        }
    }
}

pub fn has_method(h: PageObj, name: &str) -> bool {
    match h {
        PageObj::Location => matches!(name, "reload" | "assign" | "replace" | "toString"),
        PageObj::History => matches!(name, "pushState" | "replaceState" | "back" | "forward" | "go"),
        PageObj::Storage(_) => matches!(name, "getItem" | "setItem" | "removeItem" | "clear" | "key"),
        PageObj::MediaQuery(_) => matches!(name, "addEventListener" | "removeEventListener" | "addListener" | "removeListener"),
        PageObj::Crypto => name == "randomUUID",
        PageObj::StorageManager => crate::opfs::storage_has_method(name),
        PageObj::VisualViewport => matches!(name, "addEventListener" | "removeEventListener"),
        // getGamepads: the window's (a worker has none).
        PageObj::Navigator => name == "getGamepads" && crate::render_thread::is_main_thread(),
        PageObj::Screen => false,
        PageObj::Keyboard => matches!(name, "lock" | "unlock"),
        PageObj::Clipboard => matches!(name, "readText" | "writeText"),
        PageObj::WakeLock => name == "request",
        PageObj::WakeLockSentinel => matches!(name, "release" | "addEventListener" | "removeEventListener"),
    }
}

/// A method call on one of these objects.
pub fn call(h: PageObj, name: &str, args: &[Value]) -> Result<Value, String> {
    let arg = |i: usize| args.get(i).map(objects::to_display).unwrap_or_else(|| "undefined".into());
    let opt = |v: Option<String>| v.map_or(Value::Null, Value::Str);
    Ok(match (h, name) {
        (PageObj::Location, "toString") => Value::Str(page_url().to_string()),
        // A reload, or a navigation to the page's own address , starts the page
        // afresh: the program closes its window and starts again (window.rs `reload`). Anywhere else does nothing
        // natively (there is one page).
        (PageObj::Location, "reload") => {
            crate::window::reload();
            Value::Undefined
        }
        (PageObj::Location, "assign" | "replace") => {
            let page = crate::modules::page();
            if page_url().join(&arg(0)).is_ok_and(|to| to.origin() == page.origin() && to.path() == page.path()) {
                crate::window::reload();
            }
            Value::Undefined
        }
        // pushState(state, title, url) / replaceState: the URL, resolved against the current one and of the same
        // origin, becomes the current entry (pushed after it, or in its place).
        (PageObj::History, "pushState" | "replaceState") => {
            let current = page_url();
            let next = match args.get(2) {
                None | Some(Value::Undefined | Value::Null) => current.clone(),
                Some(_) => current.join(&arg(2)).map_err(|_| {
                    crate::abi::throw(crate::values::new_error("SyntaxError", &format!("Failed to execute '{name}' on 'History': A history state object with URL '{}' cannot be created.", arg(2))))
                })?,
            };
            if next.origin() != current.origin() {
                return Err(crate::abi::throw(crate::values::new_error("SecurityError", &format!("Failed to execute '{name}' on 'History': A history state object with URL '{next}' cannot be created in a document with origin '{}'.", current.origin().ascii_serialization()))));
            }
            PAGE.with(|p| {
                let mut p = p.borrow_mut();
                if p.history.is_empty() {
                    p.history.push(current);
                    p.history_at = 0;
                }
                let at = p.history_at;
                if name == "pushState" {
                    p.history.truncate(at + 1);
                    p.history.push(next);
                    p.history_at += 1;
                } else {
                    p.history[at] = next;
                }
            });
            Value::Undefined
        }
        // back / forward / go(delta): the entry moves and the window is owed a popstate.
        (PageObj::History, "back" | "forward" | "go") => {
            let delta: i64 = match name {
                "back" => -1,
                "forward" => 1,
                _ => match args.first() { Some(Value::Number(n)) => *n as i64, _ => 0 },
            };
            PAGE.with(|p| {
                let mut p = p.borrow_mut();
                let to = p.history_at as i64 + delta;
                if delta != 0 && to >= 0 && (to as usize) < p.history.len() {
                    p.history_at = to as usize;
                    p.popstate += 1;
                }
            });
            Value::Undefined
        }
        (PageObj::Storage(local), _) => with_storage(local, |storage| {
            match name {
                "getItem" => opt(storage.entries().get(&arg(0)).cloned()),
                "setItem" => {
                    let (k, v) = (arg(0), arg(1));
                    storage.entries().insert(k, v);
                    storage.save();
                    Value::Undefined
                }
                "removeItem" => {
                    if storage.entries().remove(&arg(0)).is_some() {
                        storage.save();
                    }
                    Value::Undefined
                }
                "clear" => {
                    storage.entries().clear();
                    storage.save();
                    Value::Undefined
                }
                "key" => {
                    let i = match args.first() { Some(Value::Number(n)) if *n >= 0.0 => *n as usize, _ => 0 };
                    opt(storage.entries().keys().nth(i).cloned())
                }
                _ => Value::Undefined,
            }
        }),
        (PageObj::Crypto, "randomUUID") => Value::Str(crate::web::random_uuid()?),
        (PageObj::StorageManager, _) => return crate::opfs::storage_call(name),
        (PageObj::VisualViewport, "addEventListener" | "removeEventListener") => {
            if let (Some(kind), Some(Value::Closure(c))) = (args.first(), args.get(1)) {
                let kind = objects::to_display(kind);
                VISUAL_LISTENERS.with(|l| {
                    let mut l = l.borrow_mut();
                    let at = l.iter().position(|(k, f)| *k == kind && f == c);
                    match (name == "addEventListener", at) {
                        (true, None) => {
                            crate::abi::closure_retain(*c);
                            l.push((kind, *c));
                        }
                        (false, Some(i)) => {
                            l.remove(i);
                            crate::abi::closure_release(*c);
                        }
                        _ => {}
                    }
                });
            }
            Value::Undefined
        }
        // No gamepad is connected natively yet (render_thread.rs answers the render thread's pads the same): Chrome's four
        // empty slots.
        (PageObj::Navigator, "getGamepads") => crate::values::new_array(&[Value::Null, Value::Null, Value::Null, Value::Null]),
        // A MediaQueryList's change listeners never fire natively (the device does not change).
        (PageObj::MediaQuery(_), _) => Value::Undefined,
        // keyboard.lock(keyCodes): the codes held (none named: every key), a promise resolved at once (a browser
        // keeps the request and applies it while full screen); unlock() lets them go.
        (PageObj::Keyboard, "lock") => {
            let codes = match args.first() {
                None | Some(Value::Undefined) => Vec::new(),
                Some(Value::Object(r)) => {
                    let n = match crate::values::get(*r, "length") { Ok(Some(Value::Number(n))) => n as usize, _ => 0 };
                    (0..n).map(|i| crate::values::get(*r, &i.to_string()).ok().flatten().map(|v| objects::to_display(&v)).unwrap_or_default()).collect()
                }
                Some(_) => {
                    let promise = crate::values::new_promise();
                    if let Value::Object(r) = promise {
                        crate::values::settle(r, true, &crate::values::new_error("TypeError", "Failed to execute 'lock' on 'Keyboard': The provided value cannot be converted to a sequence."));
                    }
                    return Ok(promise);
                }
            };
            crate::dom::keyboard_lock(Some(codes));
            let promise = crate::values::new_promise();
            if let Value::Object(r) = promise {
                crate::values::settle(r, false, &Value::Undefined);
            }
            promise
        }
        // clipboard.writeText(text) / readText(): the system clipboard, a promise settled at once; refused
        // (NotAllowedError) while the document does not have the focus, as a browser refuses it.
        (PageObj::Clipboard, "writeText" | "readText") => {
            let promise = crate::values::new_promise();
            let Value::Object(r) = promise else { return Ok(promise) };
            if !crate::dom::document_focused() {
                crate::values::settle(r, true, &crate::values::new_error("NotAllowedError", "Failed to execute '{name}' on 'Clipboard': Document is not focused.".replace("{name}", name).as_str()));
                return Ok(promise);
            }
            if name == "writeText" {
                let text = match args.first() {
                    Some(v) => objects::to_display(v),
                    None => {
                        crate::values::settle(r, true, &crate::values::new_error("TypeError", "Failed to execute 'writeText' on 'Clipboard': 1 argument required, but only 0 present."));
                        return Ok(promise);
                    }
                };
                crate::dom::clipboard_write_text(&text);
                crate::values::settle(r, false, &Value::Undefined);
            } else {
                crate::values::settle(r, false, &Value::Str(crate::dom::clipboard_read_text()));
            }
            promise
        }
        // wakeLock.request('screen'): the screen stays on, a sentinel at once; sentinel.release() lets it sleep again.
        (PageObj::WakeLock, "request") => {
            WAKE_LOCK.with(|l| l.set(true));
            crate::window::stay_awake(true);
            let promise = crate::values::new_promise();
            if let Value::Object(r) = &promise {
                crate::values::settle(*r, false, &objects::page_object(PageObj::WakeLockSentinel));
            }
            promise
        }
        (PageObj::WakeLockSentinel, "release") => {
            if WAKE_LOCK.with(|l| l.replace(false)) {
                crate::window::stay_awake(false);
            }
            let promise = crate::values::new_promise();
            if let Value::Object(r) = &promise {
                crate::values::settle(*r, false, &Value::Undefined);
            }
            promise
        }
        // The system never drops the lock natively, so its `release` listener is kept by no one.
        (PageObj::WakeLockSentinel, "addEventListener" | "removeEventListener") => Value::Undefined,
        (PageObj::Keyboard, "unlock") => {
            crate::dom::keyboard_lock(None);
            Value::Undefined
        }
        _ => return Err(format!("{name} is not a function")),
    })
}

/// Whether `query` matches the device and viewport (CSS px), as a browser evaluatess it.
pub fn media_matches(query: &str, (w, h): (f64, f64), dark: bool) -> bool {
    query.split(',').any(|q| {
        let q = q.trim().to_ascii_lowercase();
        let (negate, q) = match q.strip_prefix("not ") { Some(rest) => (true, rest.trim().to_string()), None => (false, q) };
        let q = q.strip_prefix("only ").map(str::to_string).unwrap_or(q);
        let all = q.split(" and ").all(|part| {
            let part = part.trim();
            if matches!(part, "all" | "screen") {
                return true;
            }
            if part == "print" {
                return false;
            }
            let Some(inner) = part.strip_prefix('(').and_then(|p| p.strip_suffix(')')) else { return false };
            let (feature, value) = match inner.split_once(':') { Some((f, v)) => (f.trim(), Some(v.trim())), None => (inner.trim(), None) };
            let px = |v: Option<&str>| v.and_then(|v| v.strip_suffix("px")).and_then(|n| n.trim().parse::<f64>().ok());
            match (feature, value) {
                ("prefers-color-scheme", Some(v)) => (v == "dark") == dark,
                ("prefers-reduced-motion" | "prefers-reduced-transparency", Some(v)) => v == "no-preference",
                ("prefers-contrast", Some(v)) => v == "no-preference",
                ("hover" | "any-hover", Some(v)) => v == if touch_points() > 0 { "none" } else { "hover" },
                ("hover" | "any-hover", None) => touch_points() == 0,
                ("pointer" | "any-pointer", Some(v)) => v == if touch_points() > 0 { "coarse" } else { "fine" },
                ("pointer" | "any-pointer", None) => true,
                ("orientation", Some(v)) => (v == "landscape") == (w >= h),
                // A document the Fullscreen API took full screen reports `fullscreen`, as Chrome's does.
                ("display-mode", Some(v)) => v == if touch_points() > 0 || crate::dom::fullscreen_active() { "fullscreen" } else { "browser" },
                ("color", _) => true,
                ("min-width", v) => px(v).is_some_and(|n| w >= n),
                ("max-width", v) => px(v).is_some_and(|n| w <= n),
                ("min-height", v) => px(v).is_some_and(|n| h >= n),
                ("max-height", v) => px(v).is_some_and(|n| h <= n),
                _ => false,
            }
        });
        all != negate
    })
}

thread_local! {
    /// visualViewport's listeners (type, callback), and the size and scroll it last reported.
    static VISUAL_LISTENERS: RefCell<Vec<(String, u64)>> = const { RefCell::new(Vec::new()) };
    static VISUAL_SEEN: std::cell::Cell<Option<(f64, f64, f64, f64)>> = const { std::cell::Cell::new(None) };
}

/// visualViewport's `resize` and `scroll` events: once a loop turn, when its size or scroll changed since the last
/// turn, its listeners of that type run (a task of their own, after the window's own resize). True when one threw.
pub fn poll_visual_viewport() -> bool {
    if VISUAL_LISTENERS.with(|l| l.borrow().is_empty()) {
        return false;
    }
    let (w, h) = viewport();
    let scroll = crate::dom::with_document_quiet(|doc| doc.viewport_scroll());
    let now = (w, h, scroll.x, scroll.y);
    let Some(before) = VISUAL_SEEN.replace(Some(now)) else { return false };
    let mut kinds = Vec::new();
    if (before.0, before.1) != (now.0, now.1) {
        kinds.push("resize");
    }
    if (before.2, before.3) != (now.2, now.3) {
        kinds.push("scroll");
    }
    for kind in kinds {
        let callbacks: Vec<u64> = VISUAL_LISTENERS.with(|l| l.borrow().iter().filter(|(k, _)| k == kind).map(|(_, c)| *c).collect());
        let _op = objects::Op::enter();
        let event = crate::values::new_object();
        if let Value::Object(e) = event {
            let _ = crate::values::set(e, "type", Value::Str(kind.into()));
            let _ = crate::values::set(e, "target", objects::page_object(PageObj::VisualViewport));
        }
        for c in callbacks {
            if crate::abi::call_closure(c, std::slice::from_ref(&event)).is_err() {
                return true;
            }
        }
    }
    false
}
