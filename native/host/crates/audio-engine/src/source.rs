//! AudioBufferSourceNode: the spec's playback algorithm (start with offset and duration, loop points, k-rate
//! playbackRate and detune), reading the buffer with linear interpolation between frames, so a start between two
//! frames, a playback rate other than 1, or a buffer at another rate than the context's all play at the right place.

use std::sync::Arc;

use crate::BufferData;
use crate::bus::Bus;
use crate::graph::Garbage;
use crate::nodes::{Ctx, Schedule};
use crate::param::{AudioParam, QUANTUM, Rate};

pub struct BufferSource {
    pub buffer: Option<Arc<BufferData>>,
    pub playback_rate: AudioParam,
    pub detune: AudioParam,
    pub looping: bool,
    pub loop_start: f64,
    pub loop_end: f64,
    pub sched: Schedule,
    /// start()'s offset (seconds into the buffer) and duration (seconds of buffer played, loops counted).
    pub offset: f64,
    pub duration: f64,
    /// The playhead, in the buffer's frames.
    position: f64,
    /// Buffer frames played so far, for `duration`.
    elapsed: f64,
    entered_loop: bool,
}

impl BufferSource {
    pub fn new() -> BufferSource {
        BufferSource {
            buffer: None,
            playback_rate: AudioParam::new(1.0, f32::MIN, f32::MAX, Rate::K),
            detune: AudioParam::new(0.0, f32::MIN, f32::MAX, Rate::K),
            looping: false,
            loop_start: 0.0,
            loop_end: 0.0,
            sched: Schedule::new(),
            offset: 0.0,
            duration: f64::INFINITY,
            position: 0.0,
            elapsed: 0.0,
            entered_loop: false,
        }
    }

    pub fn start(&mut self, when: f64, offset: f64, duration: Option<f64>) {
        if self.sched.start.is_some() {
            return;
        }
        self.sched.start = Some(when.max(0.0));
        self.offset = offset.max(0.0);
        self.duration = duration.unwrap_or(f64::INFINITY).max(0.0);
    }

    /// Renders one quantum; true when the source ended in it (stopped, played out, or its duration reached).
    pub fn process(&mut self, out: &mut Bus, ctx: &Ctx, trash: &mut Vec<Garbage>) -> bool {
        self.playback_rate.compute(ctx.frame0, ctx.sample_rate, trash);
        self.detune.compute(ctx.frame0, ctx.sample_rate, trash);
        out.set_silent();
        let Some(when) = self.sched.start else { return false };
        if self.sched.ended {
            return false;
        }
        let t_end = ctx.time(QUANTUM);
        if t_end <= when && t_end < self.sched.stop {
            return false;
        }
        let stop = self.sched.stop;
        let Some(buffer) = self.buffer.as_deref().filter(|b| b.frames() > 0 && !b.channels.is_empty()) else {
            // No buffer: silence until stopped.
            return self.finish_if(t_end >= stop);
        };
        let rate = self.playback_rate.first() as f64 * (self.detune.first() as f64 / 1200.0).exp2();
        let buffer_rate = buffer.sample_rate as f64;
        let channels = buffer.channels.len().min(2);
        // The shortest of the channels read, so channels of different lengths can never be read past their end.
        let last_frame = buffer.channels[..channels].iter().map(Vec::len).min().unwrap_or(0);
        if last_frame == 0 {
            return self.finish_if(t_end >= stop);
        }
        let frames = last_frame as f64;
        // Frames of the buffer the playhead moves per frame of the context.
        let step = rate * buffer_rate / ctx.sample_rate;

        let (loop_start, loop_end) = if self.looping {
            let duration = frames / buffer_rate;
            if self.loop_start >= 0.0 && self.loop_end > 0.0 && self.loop_start < self.loop_end {
                (self.loop_start * buffer_rate, self.loop_end.min(duration) * buffer_rate)
            } else {
                (0.0, frames)
            }
        } else {
            self.entered_loop = false;
            (0.0, frames)
        };
        let loop_length = loop_end - loop_start;
        let mut offset = self.offset * buffer_rate;

        out.zeroed(channels);
        let mut finished = false;
        for i in 0..QUANTUM {
            let t = ctx.time(i);
            if t < when {
                continue;
            }
            if t >= stop || self.elapsed >= self.duration * buffer_rate {
                finished = true;
                break;
            }
            if !self.sched.started {
                if self.looping && rate >= 0.0 && offset >= loop_end {
                    offset = loop_end;
                }
                if self.looping && rate < 0.0 && offset < loop_start {
                    offset = loop_start;
                }
                self.offset = offset / buffer_rate;
                // A start between two frames begins that far into the buffer (sub-sample accuracy).
                let into = (t - when) * rate * buffer_rate;
                self.position = offset + into;
                self.elapsed = into.abs();
                self.sched.started = true;
            }
            if self.looping {
                if !self.entered_loop
                    && ((offset < loop_end && self.position >= loop_start) || (offset >= loop_end && self.position < loop_end))
                {
                    self.entered_loop = true;
                }
                if self.entered_loop && loop_length > 0.0 && (self.position >= loop_end || self.position < loop_start) {
                    self.position = loop_start + (self.position - loop_start).rem_euclid(loop_length);
                }
            } else if (step >= 0.0 && self.position >= frames) || (step < 0.0 && self.position < 0.0) {
                finished = true;
                break;
            }
            if self.position >= 0.0 && self.position < frames {
                let i0 = self.position as usize;
                let frac = (self.position - i0 as f64) as f32;
                let last = last_frame - 1;
                let mut i1 = i0 + 1;
                if self.looping && self.entered_loop && i1 as f64 >= loop_end {
                    i1 = loop_start.ceil() as usize;
                }
                let i1 = i1.min(last);
                for c in 0..channels {
                    let d = &buffer.channels[c];
                    let (a, b) = (d[i0], d[i1]);
                    out.ch[c][i] = if frac == 0.0 { a } else { a + (b - a) * frac };
                }
            }
            self.position += step;
            self.elapsed += step.abs();
        }
        if !finished {
            // Reached its stop time at the quantum's end, or (started) played out without looping, or its duration.
            let played_out = !self.looping && ((step >= 0.0 && self.position >= frames) || (step < 0.0 && self.position < 0.0));
            finished = t_end >= stop || (self.sched.started && (played_out || self.elapsed >= self.duration * buffer_rate));
        }
        self.finish_if(finished)
    }

    fn finish_if(&mut self, finished: bool) -> bool {
        if finished {
            self.sched.ended = true;
        }
        finished
    }
}
