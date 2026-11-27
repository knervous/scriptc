//! A link the program was launched with: a URL on the command line (a protocol handler's `"%1"`, such as
//! `<scheme>://join#j=<token>`, or a page link pasted onto the command line). Only its fragment is taken, and only when
//! it is one `name=token` pair of URL-safe characters no longer than [`MAX_FRAGMENT`]: the page's address gets that
//! fragment at start (modules.rs `page`), as a browser opening the link would see it. The rest of the URL (its scheme,
//! host, path and query) is never used: the argument is untrusted input.
//!
//! Windows: a launch with such a link while the program's window is already open (another process's window of this
//! host's class) hands the fragment to that window instead (WM_COPYDATA) and brings it to the front; this process
//! then exits. The window moves its page's address to the fragment as a navigation within the page does (popstate,
//! then hashchange: page.rs `open_fragment`). SCRIPTC_HOST_SINGLE_INSTANCE=0 starts a second instance anyway.

use std::sync::OnceLock;

/// The longest fragment taken (a link's token, a compressed SDP offer in practice, is 1 to 3 KB).
pub const MAX_FRAGMENT: usize = 16 * 1024;

/// The fragment as the page will have it (no leading '#'), when `text` is one `name=token` pair: a name of up to 16
/// ASCII letters and digits starting with a letter, and a token of base64url characters.
pub fn valid_fragment(text: &str) -> Option<String> {
    let text = text.strip_prefix('#').unwrap_or(text);
    if text.is_empty() || text.len() > MAX_FRAGMENT {
        return None;
    }
    let (name, token) = text.split_once('=')?;
    let name_ok = !name.is_empty() && name.len() <= 16 && name.starts_with(|c: char| c.is_ascii_alphabetic()) && name.chars().all(|c| c.is_ascii_alphanumeric());
    let token_ok = !token.is_empty() && token.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    (name_ok && token_ok).then(|| text.to_string())
}

/// The fragment of the first command-line argument that is an absolute URL with an acceptable fragment.
pub fn launch_fragment() -> Option<String> {
    static FRAGMENT: OnceLock<Option<String>> = OnceLock::new();
    FRAGMENT
        .get_or_init(|| {
            std::env::args().skip(1).filter(|a| a.len() <= MAX_FRAGMENT + 256).find_map(|a| {
                let u = url::Url::parse(a.trim()).ok()?;
                valid_fragment(u.fragment()?)
            })
        })
        .clone()
}

/// WM_COPYDATA's `dwData` for a fragment handed to a running window.
#[cfg(all(windows, feature = "window"))]
pub const COPYDATA_FRAGMENT: usize = 0x5348_4652; // "SHFR"

/// A launch with a link while another instance's window is open: the link goes there and this process exits.
#[cfg(all(windows, feature = "window"))]
pub fn forward_if_running() {
    use windows_sys::Win32::System::DataExchange::COPYDATASTRUCT;
    use windows_sys::Win32::UI::WindowsAndMessaging as wm;

    let Some(fragment) = launch_fragment() else { return };
    if std::env::var("SCRIPTC_HOST_SINGLE_INSTANCE").as_deref() == Ok("0") {
        return;
    }
    let class: Vec<u16> = crate::window::window_class().encode_utf16().chain(std::iter::once(0)).collect();
    // SAFETY: a lookup by class name; the data block lives across the synchronous send.
    unsafe {
        let hwnd = wm::FindWindowW(class.as_ptr(), std::ptr::null());
        if hwnd.is_null() {
            return;
        }
        let data = COPYDATASTRUCT { dwData: COPYDATA_FRAGMENT, cbData: fragment.len() as u32, lpData: fragment.as_ptr() as *mut _ };
        let mut answer: usize = 0;
        let sent = wm::SendMessageTimeoutW(hwnd, wm::WM_COPYDATA, 0, &raw const data as isize, wm::SMTO_ABORTIFHUNG, 5000, &mut answer);
        if sent == 0 || answer == 0 {
            // Not taken (a window that does not answer): this launch goes on as an instance of its own.
            return;
        }
        if wm::IsIconic(hwnd) != 0 {
            wm::ShowWindow(hwnd, wm::SW_RESTORE);
        }
        wm::SetForegroundWindow(hwnd);
    }
    eprintln!("scriptc-host: the link went to the window already open");
    std::process::exit(0);
}
