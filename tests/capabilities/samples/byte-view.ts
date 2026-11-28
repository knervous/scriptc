const b = new Uint8Array(4); b[0] = 42;
const sink: any = (globalThis as any).sink;
console.log(typeof sink === "function" ? sink(b) : "nosink");
