export function run() { var b = new ArrayBuffer(8); var v = new Uint8Array(b); v[0] = 7; return v.length + ":" + new Uint8Array(b)[0]; }
