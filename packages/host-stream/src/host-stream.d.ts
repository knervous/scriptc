// The host half of a stream (src/host.js). Every channel is one stream: its arena is attached once, and each flush names how many
// words of it are written and the text its string spans point into.
declare module "host:stream" {
  /** The channel's arena: command words from byte 0, the host's records and event fields after `recordsAt`. */
  export function attach(channel: number, arena: Uint8Array, recordsAt: number): void;
  /** The first `words` words of the channel's arena are commands, and `text` holds every string they name. */
  export function flush(channel: number, words: number, text: string): void;
}
