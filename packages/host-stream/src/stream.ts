/// <reference path="./host-stream.d.ts" />
// The compiled half of a host stream: commands written as 32-bit words into an arena in module memory, handed to the host once per
// flush (src/host.js replays them in one loop), and records the host keeps in the same arena, read here in place.
//
// Format (the generator's, src/gen.mjs): every command is `[op, n, args...]`, n the number of argument words, so a reader can skip a
// command it does not know. Handles and atoms are one word. A string is two words, its offset and length in the flush's text: every
// string of a flush is appended to one text, which crosses with the flush, so no string is encoded or copied on the way. An f64 is two
// words, its low and high halves. Op 1 is the stream's own: ATOM id text, a name the host keeps for the rest of the stream's life.
import { attach, flush } from "host:stream";

/** The command that defines an atom (the generator's ATOM_OP). */
const ATOM_OP = 1;

export class HostStream {
  readonly channel: number;
  /** The arena: command words from 0, the records from `recordsAt` (bytes). */
  readonly bytes: Uint8Array;
  readonly words: Int32Array;
  readonly floats: Float64Array;
  /** Command words: the arena's first `commandWords`. */
  readonly commandWords: number;
  /** The next command word. */
  at: number = 0;
  /** Every string of this flush, end to end. */
  text: string = "";
  textLength: number = 0;
  private readonly atoms: Map<string, number> = new Map();
  private nextAtom: number = 1;
  private readonly scratch: Float64Array = new Float64Array(1);
  private readonly scratchWords: Int32Array;
  /** Set by flushes the stream makes for room (a command that did not fit). */
  overflows: number = 0;

  /** `commandWords` words for commands and `recordWords` after them for the host's records. */
  constructor(channel: number, commandWords: number, recordWords: number) {
    this.channel = channel;
    this.commandWords = commandWords;
    this.bytes = new Uint8Array((commandWords + recordWords) * 4 + 8);
    this.words = new Int32Array(this.bytes.buffer);
    this.floats = new Float64Array(this.bytes.buffer);
    this.scratchWords = new Int32Array(this.scratch.buffer);
    attach(channel, this.bytes, commandWords * 4);
  }

  /** Room for a command of `size` words (op and count included): its first word. A full arena is flushed first. */
  reserve(size: number): number {
    let at = this.at;
    if (at + size > this.commandWords) {
      this.overflows++;
      this.flush();
      at = 0;
    }
    this.at = at + size;
    return at;
  }

  /** Appends `s` to the flush's text: its offset there. Its length is `s.length`. */
  str(s: string): number {
    const at = this.textLength;
    this.text += s;
    this.textLength = at + s.length;
    return at;
  }

  /** Writes `v` as two words at `at`. */
  f64(at: number, v: number): void {
    this.scratch[0] = v;
    this.words[at] = this.scratchWords[0]!;
    this.words[at + 1] = this.scratchWords[1]!;
  }

  /** The atom for `name`: defined in the stream the first time. */
  atom(name: string): number {
    const known = this.atoms.get(name);
    if (known !== undefined) return known;
    const id = this.nextAtom++;
    this.atoms.set(name, id);
    const at = this.reserve(5);
    const w = this.words;
    w[at] = ATOM_OP;
    w[at + 1] = 3;
    w[at + 2] = id;
    w[at + 3] = this.str(name);
    w[at + 4] = name.length;
    return id;
  }

  /** Whether commands are waiting. */
  pending(): boolean {
    return this.at > 0;
  }

  /** Hands the written commands to the host, which runs them before this returns. */
  flush(): void {
    const words = this.at;
    const text = this.text;
    this.at = 0;
    this.text = "";
    this.textLength = 0;
    flush(this.channel, words, text);
  }

  /** A record word the host wrote (`index` in words from the records' start). */
  recordWord(index: number): number {
    return this.words[this.commandWords + index]!;
  }

  /** A record f64 the host wrote (`index` in words from the records' start, even). */
  recordF64(index: number): number {
    return this.floats[(this.commandWords + index) >> 1]!;
  }
}
