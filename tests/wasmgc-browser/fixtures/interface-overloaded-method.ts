// An overloaded interface method is one function at run time: calls through the interface reach the implementation
// with exactly the arguments passed (WebGPU's setBindGroup / copyBufferToBuffer overloads).
class Buf {
  readonly id: number;
  constructor(id: number) { this.id = id; }
}
interface Encoder {
  setBindGroup(index: number, group: string, offsets?: number[]): void;
  setBindGroup(index: number, group: string, data: Uint32Array, start: number, length: number): void;
  copy(src: Buf, dst: Buf, size?: number): string;
  copy(src: Buf, srcOffset: number, dst: Buf, dstOffset: number, size?: number): string;
}
class Recorder implements Encoder {
  log: string[] = [];
  setBindGroup(index: number, group: string, offsets?: number[] | Uint32Array, start?: number, length?: number): void {
    this.log.push(`bg ${index} ${group} ${offsets === undefined ? "-" : offsets.length} ${start ?? "-"} ${length ?? "-"}`);
  }
  copy(src: Buf, a: Buf | number, b?: Buf | number, c?: number, d?: number): string {
    return typeof a === "number" ? `copy ${src.id}+${a} -> ${(b as Buf).id}+${c} x${d ?? "all"}` : `copy ${src.id} -> ${a.id} x${(b as number | undefined) ?? "all"}`;
  }
}
const r = new Recorder();
const enc: Encoder = r;
enc.setBindGroup(0, "scene");
enc.setBindGroup(1, "mat", [4, 8]);
enc.setBindGroup(2, "dyn", new Uint32Array([1, 2, 3, 4]), 1, 2);
console.log(enc.copy(new Buf(1), new Buf(2)), "|", enc.copy(new Buf(1), new Buf(2), 64));
console.log(enc.copy(new Buf(3), 16, new Buf(4), 32), "|", enc.copy(new Buf(3), 16, new Buf(4), 32, 8));
console.log(r.log.join("; "));
const lit: Encoder = {
  setBindGroup(index: number, group: string): void { console.log("lit bg", index, group); },
  copy(src: Buf): string { return `lit copy ${src.id}`; },
};
lit.setBindGroup(5, "x", new Uint32Array(2), 0, 1);
console.log(lit.copy(new Buf(9), 1, new Buf(8), 2));
