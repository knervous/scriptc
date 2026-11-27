//! A node's input or output for one quantum: up to two channels, or silence (no channels), and the spec's "speakers"
//! up-mixing and down-mixing between mono and stereo.

use crate::param::QUANTUM;

pub struct Bus {
    pub ch: [[f32; QUANTUM]; 2],
    /// 0 when silent (nothing connected, or nothing playing), else 1 or 2.
    pub channels: usize,
}

impl Bus {
    pub const fn new() -> Bus {
        Bus { ch: [[0.0; QUANTUM]; 2], channels: 0 }
    }

    pub fn silent(&self) -> bool {
        self.channels == 0
    }

    pub fn set_silent(&mut self) {
        self.channels = 0;
    }

    /// Makes the bus `channels` wide and zeroed, to be written into.
    pub fn zeroed(&mut self, channels: usize) {
        self.channels = channels;
        for c in &mut self.ch[..channels] {
            c.fill(0.0);
        }
    }

    /// Sums `src` in, the result as wide as the wider of the two (mode "max" / "clamped-max" with a channel count of 2,
    /// which is every node here): mono up-mixes to stereo as L = R = M.
    pub fn mix_in(&mut self, src: &Bus) {
        match (self.channels, src.channels) {
            (_, 0) => {}
            (0, n) => {
                self.channels = n;
                self.ch[..n].copy_from_slice(&src.ch[..n]);
            }
            (1, 2) => {
                self.ch[1] = self.ch[0];
                self.channels = 2;
                add(&mut self.ch[0], &src.ch[0]);
                add(&mut self.ch[1], &src.ch[1]);
            }
            (2, 1) => {
                let [l, r] = &mut self.ch;
                add(l, &src.ch[0]);
                add(r, &src.ch[0]);
            }
            (n, _) => {
                for c in 0..n {
                    add(&mut self.ch[c], &src.ch[c]);
                }
            }
        }
    }

    /// Up-mixes in place to stereo (a silent bus stays silent).
    pub fn up_mix_stereo(&mut self) {
        if self.channels == 1 {
            self.ch[1] = self.ch[0];
            self.channels = 2;
        }
    }

    /// Sums `src` mixed down to mono into `dst` (a param's input: M = 0.5 (L + R)).
    pub fn add_mono_to(&self, dst: &mut [f32; QUANTUM]) {
        match self.channels {
            1 => add(dst, &self.ch[0]),
            2 => {
                for ((d, l), r) in dst.iter_mut().zip(&self.ch[0]).zip(&self.ch[1]) {
                    *d += 0.5 * (l + r);
                }
            }
            _ => {}
        }
    }

    /// The largest absolute sample.
    pub fn peak(&self) -> f32 {
        let mut p = 0.0f32;
        for c in &self.ch[..self.channels] {
            for &x in c {
                p = p.max(x.abs());
            }
        }
        p
    }
}

pub fn add(dst: &mut [f32; QUANTUM], src: &[f32; QUANTUM]) {
    for (d, s) in dst.iter_mut().zip(src.iter()) {
        *d += s;
    }
}
