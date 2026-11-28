/* @scriptc-intrinsics atomics/1 */
/* Typed atomic cells over integer typed arrays: load, store, add, sub, and,
 * or, xor, exchange, compare-exchange, wait and notify on one element.
 *
 * Every operation is the matching Atomics call, so Node runs this module as
 * written, and scriptc compiles each to an atomic instruction on module
 * memory (WasmGC: the threads proposal's atomic instructions; native: C11
 * atomics in the runtime). Over a SharedArrayBuffer (threads=shared) the cells
 * coordinate workers; over a plain ArrayBuffer (threads=off) the same code
 * runs on one thread with the same results: wait returns "not-equal" or
 * "timed-out" instead of blocking, and notify wakes nobody and returns 0.
 * Atomics.wait is refused on the browser target (the page's thread must not
 * block); use waitAsync from JavaScript there. */

import type { Int32, Uint32 } from "./int.ts";

/** One int32 cell: element `index` of `cells`. */
export class AtomicInt32 {
  readonly cells: Int32Array;
  readonly index: number;
  constructor(cells: Int32Array, index = 0) {
    if (index < 0 || index >= cells.length) throw new RangeError(`AtomicInt32: index ${index} is outside the array`);
    this.cells = cells;
    this.index = index;
  }
  load(): Int32 { return Atomics.load(this.cells, this.index); }
  /** Stores ToInt32(value); returns value as Atomics.store does (converted to an integer, not wrapped). */
  store(value: number): number { return Atomics.store(this.cells, this.index, value); }
  /** Adds and returns the previous value. */
  add(value: number): Int32 { return Atomics.add(this.cells, this.index, value); }
  sub(value: number): Int32 { return Atomics.sub(this.cells, this.index, value); }
  and(value: number): Int32 { return Atomics.and(this.cells, this.index, value); }
  or(value: number): Int32 { return Atomics.or(this.cells, this.index, value); }
  xor(value: number): Int32 { return Atomics.xor(this.cells, this.index, value); }
  exchange(value: number): Int32 { return Atomics.exchange(this.cells, this.index, value); }
  /** Stores `replacement` when the cell holds `expected`; returns what it held. */
  compareExchange(expected: number, replacement: number): Int32 { return Atomics.compareExchange(this.cells, this.index, expected, replacement); }
  /** Blocks while the cell holds `expected` (shared memory, off the browser's page thread). */
  wait(expected: number, timeoutMs?: number): "ok" | "not-equal" | "timed-out" {
    return timeoutMs === undefined ? Atomics.wait(this.cells, this.index, expected) : Atomics.wait(this.cells, this.index, expected, timeoutMs);
  }
  /** Wakes up to `count` waiters (all by default); returns how many woke. */
  notify(count?: number): number { return count === undefined ? Atomics.notify(this.cells, this.index) : Atomics.notify(this.cells, this.index, count); }
}

/** One uint32 cell: element `index` of `cells`. */
export class AtomicUint32 {
  readonly cells: Uint32Array;
  readonly index: number;
  constructor(cells: Uint32Array, index = 0) {
    if (index < 0 || index >= cells.length) throw new RangeError(`AtomicUint32: index ${index} is outside the array`);
    this.cells = cells;
    this.index = index;
  }
  load(): Uint32 { return Atomics.load(this.cells, this.index); }
  store(value: number): number { return Atomics.store(this.cells, this.index, value); }
  add(value: number): Uint32 { return Atomics.add(this.cells, this.index, value); }
  sub(value: number): Uint32 { return Atomics.sub(this.cells, this.index, value); }
  and(value: number): Uint32 { return Atomics.and(this.cells, this.index, value); }
  or(value: number): Uint32 { return Atomics.or(this.cells, this.index, value); }
  xor(value: number): Uint32 { return Atomics.xor(this.cells, this.index, value); }
  exchange(value: number): Uint32 { return Atomics.exchange(this.cells, this.index, value); }
  compareExchange(expected: number, replacement: number): Uint32 { return Atomics.compareExchange(this.cells, this.index, expected, replacement); }
}

/** A job counter: workers claim job indexes in order until `total`, each index exactly once, on any number of threads. */
export class WorkCounter {
  readonly cell: AtomicInt32;
  readonly total: number;
  constructor(cells: Int32Array, index: number, total: number) {
    this.cell = new AtomicInt32(cells, index);
    this.total = total;
  }
  /** The next unclaimed job, or -1 when every job is claimed. */
  claim(): Int32 {
    const job = this.cell.add(1);
    return job < this.total ? job : -1;
  }
  reset(): void { this.cell.store(0); }
}

/** A spin lock in one int32 cell (0 free, 1 held), for short critical sections between workers. */
export class SpinLock {
  readonly cell: AtomicInt32;
  constructor(cells: Int32Array, index = 0) { this.cell = new AtomicInt32(cells, index); }
  tryLock(): boolean { return this.cell.compareExchange(0, 1) === 0; }
  lock(): void { while (this.cell.compareExchange(0, 1) !== 0) { /* spin */ } }
  unlock(): void { this.cell.store(0); }
}
