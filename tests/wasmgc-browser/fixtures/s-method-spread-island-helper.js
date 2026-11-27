globalThis.__sink = [0];
globalThis.__set = new Set();
export function pushAll(x) { return globalThis.__sink.push(...x); }
export function pushPre(x) { return globalThis.__sink.push(9, ...x); }
export function sink() { return globalThis.__sink.join(); }
export function maxOf(x) { return Math.max.apply(null, x); }
export function bad() { try { globalThis.__sink.push(...undefined); } catch (e) { return e instanceof TypeError; } }
