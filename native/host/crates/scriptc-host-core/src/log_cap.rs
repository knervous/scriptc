//! The cap on one launch's log (the layer's `log_dir`): the writers append to the log unbuffered and unchanged (nothing on their
//! path), and a watcher thread looks at the file's size now and then. Past [`LIMITS`]`.cap` the file is compacted in
//! place: its first `head` bytes (to the end of a line) stay, a marker line says how much was cut, and the last
//! `tail` bytes (from the start of a line) follow. A long run's start (the build, the device, the first errors) and
//! its end (what led to a crash) are both kept, and the file stays under the cap plus what is written between two
//! looks.
//!
//! The compaction truncates the file to the head's end through a read/write handle of its own and appends the marker
//! and the tail through the writers' append-only handle, so anything written after it lands after them. The caller
//! holds the writers (the standard streams' locks) while it runs.

use std::fs::File;
use std::io::{self, Write};
use std::os::windows::fs::FileExt;

/// When a log is compacted (`cap`), and what of it is kept: the first `head` bytes and the last `tail`.
#[derive(Clone, Copy, Debug)]
pub struct Limits {
    pub cap: u64,
    pub head: u64,
    pub tail: u64,
}

/// One launch's log: compacted past 64 MiB to its first and last 16 MiB (about 32 MiB, so the next compaction is
/// another 32 MiB of output away).
pub const LIMITS: Limits = Limits { cap: 64 << 20, head: 16 << 20, tail: 16 << 20 };

/// What the compactions of one log have done so far.
#[derive(Default, Debug)]
pub struct Cap {
    /// Where the kept head ends (fixed at the first compaction).
    head_end: Option<u64>,
    /// Bytes cut, over every compaction.
    pub cut: u64,
    /// Compactions made.
    pub times: u32,
}

impl Cap {
    /// When `file` (a read/write handle on the log) is past `limits.cap`: its head kept, the middle cut, a marker and
    /// its tail appended through `append` (the writers' append-only handle). The bytes cut (0 when under the cap).
    pub fn compact(&mut self, file: &File, append: &File, limits: Limits) -> io::Result<u64> {
        let len = file.metadata()?.len();
        if len <= limits.cap {
            return Ok(0);
        }
        let head_end = match self.head_end {
            Some(h) => h,
            None => {
                let h = line_end_before(file, limits.head.min(len))?;
                self.head_end = Some(h);
                h
            }
        };
        let from = len.saturating_sub(limits.tail).max(head_end);
        let mut tail = vec![0u8; (len - from) as usize];
        read_exact_at(file, &mut tail, from)?;
        // The tail starts at a line's start (unless the line is longer than the tail).
        let skip = if from == head_end { 0 } else { tail.iter().position(|&b| b == b'\n').map_or(0, |i| i + 1) };
        let cut = from + skip as u64 - head_end;
        self.cut += cut;
        self.times += 1;
        let marker = format!(
            "\n[scriptc-host: this log passed {} MiB: {cut} bytes cut here ({} in {} cuts this launch); its first {} MiB are above, its last {} MiB below]\n",
            limits.cap >> 20,
            self.cut,
            self.times,
            limits.head >> 20,
            limits.tail >> 20,
        );
        let mut out = Vec::with_capacity(marker.len() + tail.len() - skip);
        out.extend_from_slice(marker.as_bytes());
        out.extend_from_slice(&tail[skip..]);
        file.set_len(head_end)?;
        let mut append = append;
        append.write_all(&out)?;
        Ok(cut)
    }
}

/// Where the line holding byte `at - 1` ends: just past the last newline in the 64 KiB before `at`, else `at`.
fn line_end_before(file: &File, at: u64) -> io::Result<u64> {
    let from = at.saturating_sub(64 << 10);
    let mut buf = vec![0u8; (at - from) as usize];
    read_exact_at(file, &mut buf, from)?;
    Ok(buf.iter().rposition(|&b| b == b'\n').map_or(at, |i| from + i as u64 + 1))
}

fn read_exact_at(file: &File, mut buf: &mut [u8], mut at: u64) -> io::Result<()> {
    while !buf.is_empty() {
        match file.seek_read(buf, at)? {
            0 => return Err(io::ErrorKind::UnexpectedEof.into()),
            n => {
                buf = &mut buf[n..];
                at += n as u64;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::OpenOptions;
    use std::os::windows::fs::OpenOptionsExt;

    const SHARE_ALL: u32 = 0x7; // FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE

    fn open(path: &std::path::Path) -> (File, File) {
        let append = OpenOptions::new().append(true).create(true).share_mode(SHARE_ALL).open(path).unwrap();
        let file = OpenOptions::new().read(true).write(true).share_mode(SHARE_ALL).open(path).unwrap();
        (file, append)
    }

    #[test]
    fn keeps_the_head_and_the_tail_on_line_boundaries() {
        let dir = std::env::temp_dir().join(format!("log-cap-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("a.log");
        let _ = std::fs::remove_file(&path);
        let (file, append) = open(&path);
        let limits = Limits { cap: 4000, head: 1000, tail: 1000 };
        let mut cap = Cap::default();
        let mut writer = &append;
        let mut written = Vec::new();
        for i in 0..2000 {
            let line = format!("line {i:05}\n");
            writer.write_all(line.as_bytes()).unwrap();
            written.push(line);
            cap.compact(&file, &append, limits).unwrap();
            assert!(file.metadata().unwrap().len() <= limits.cap + 200);
        }
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(cap.times > 1, "{cap:?}");
        assert!(!text.contains('\0'), "no gap of zeros");
        // The head: the first lines, whole.
        assert!(text.starts_with("line 00000\nline 00001\n"));
        let head = text.split("\n[scriptc-host").next().unwrap();
        assert!(head.len() <= 1000 && head.len() > 900, "{}", head.len());
        // The end: the last lines, in order, every one whole.
        assert!(text.ends_with("line 01998\nline 01999\n"));
        let after = text.rsplit("MiB below]\n").next().unwrap();
        let lines: Vec<&str> = after.lines().collect();
        let first: usize = lines[0][5..].parse().unwrap();
        for (k, l) in lines.iter().enumerate() {
            assert_eq!(*l, format!("line {:05}", first + k));
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn under_the_cap_nothing_changes() {
        let dir = std::env::temp_dir().join(format!("log-cap-test-u-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("a.log");
        let _ = std::fs::remove_file(&path);
        let (file, append) = open(&path);
        (&append).write_all(b"one\ntwo\n").unwrap();
        assert_eq!(Cap::default().compact(&file, &append, Limits { cap: 8, head: 4, tail: 4 }).unwrap(), 0);
        assert_eq!(std::fs::read(&path).unwrap(), b"one\ntwo\n");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
