// Copied from packages/host-stream/src/host.js by packages/lui/scripts/sync-stream.mjs. Do not edit; edit the original and run the script.
// The host half of `host:stream` (src/stream.ts): each channel's arena is attached once, and a flush hands its consumer the command
// words, how many there are, and the flush's text. The consumer is a generated replay (src/gen.mjs) over the channel's handlers.
//
// The arena is a view of the module's memory. A view can detach when the memory grows, so the views are remade from the memory's
// current buffer whenever it changed; the arena's place in memory does not move.

/**
 * @param {() => WebAssembly.Memory | undefined} [memoryOf] the module's memory once it is instantiated (else the attached view's own
 *   buffer is used, which is right until the memory grows)
 */
export function createHostStreams(memoryOf) {
  /** @type {Map<number, Channel>} */
  const channels = new Map();
  /** @type {Map<number, (channel: Channel) => void>} */
  const consumers = new Map();

  class Channel {
    constructor(id, view, recordsAt) {
      this.id = id;
      this.offset = view.byteOffset;
      this.byteLength = view.byteLength;
      this.recordsAt = recordsAt;
      this.buffer = null;
      this.words = null;
      this.floats = null;
      /** The atoms the stream defined, by id. */
      this.atoms = [""];
      /** The handlers of this channel's commands (set by its consumer). */
      this.handlers = null;
      this.replay = null;
      this.flushes = 0;
      this.commands = 0;
      this.view(view.buffer);
    }

    /** Remakes the views when the memory's buffer changed. */
    view(buffer) {
      const now = buffer ?? memoryOf?.()?.buffer;
      if (now === undefined || now === this.buffer) return;
      this.buffer = now;
      this.words = new Int32Array(now, this.offset, this.byteLength >>> 2);
      this.floats = new Float64Array(now, this.offset, this.byteLength >>> 3);
    }

    /** Current views (the memory may have grown since the last flush). */
    fresh() {
      const memory = memoryOf?.();
      if (memory !== undefined && memory.buffer !== this.buffer) this.view(memory.buffer);
      else if (this.words.byteLength === 0) this.view(memory?.buffer);
      return this;
    }

    /** The first record word, as an index into `words`. */
    get recordBase() { return this.recordsAt >>> 2; }
  }

  const imports = {
    "host:stream": {
      attach(id, view, recordsAt) {
        const channel = new Channel(id, view, recordsAt);
        channels.set(id, channel);
        const consumer = consumers.get(id);
        if (consumer !== undefined) consumer(channel);
      },
      flush(id, count, text) {
        const channel = channels.get(id);
        if (channel === undefined || channel.replay === null) throw new Error(`host:stream: channel ${id} flushed with no consumer`);
        channel.fresh();
        channel.flushes++;
        channel.commands += channel.replay(channel.words, 0, count, text, channel.atoms, channel.handlers);
      },
    },
  };

  return {
    imports,
    channels,
    /**
     * Who replays channel `id`: `setup(channel)` runs when the module attaches its arena (at once, if it already has), and sets
     * `channel.replay` (a generated replay function) and `channel.handlers`.
     */
    consume(id, setup) {
      consumers.set(id, setup);
      const channel = channels.get(id);
      if (channel !== undefined) setup(channel);
    },
  };
}
