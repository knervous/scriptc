// Typed arrays as Map and index-signature values: stored, read back, mutated
// through the stored reference (identity, not a copy), replaced, deleted and
// iterated, in a Map and in a Record field of a class.
const views = new Map<string, Float32Array>();
const backing = new Float32Array(8);
views.set("a", backing.subarray(0, 4));
views.set("b", backing.subarray(4, 8));
views.get("a")![1] = 2.5;
views.get("b")![0] = -1;
console.log(Array.from(backing).join(","), views.size, views.has("b"));
views.set("a", new Float32Array([9, 8]));
console.log(Array.from(views.get("a")!).join(","), backing[1]);
views.delete("b");
for (const [k, v] of views) console.log(k, v.length, v instanceof Float32Array);

class Planes {
  private bytes: Record<string, Uint8Array> = {};
  private floats: Record<string, Float32Array> = {};
  put(name: string, n: number): void {
    this.bytes[name] = new Uint8Array(n);
    this.floats[name] = new Float32Array(n);
  }
  mark(name: string, i: number): void {
    const b = this.bytes[name];
    if (b) b[i] = 255;
    this.floats[name][i] += 0.5;
  }
  dump(): string {
    return Object.keys(this.bytes)
      .map((k) => `${k}:${Array.from(this.bytes[k]).join("")}/${Array.from(this.floats[k]).join("|")}`)
      .join(" ");
  }
}
const p = new Planes();
p.put("x", 3);
p.put("y", 2);
p.mark("x", 1);
p.mark("y", 0);
p.mark("y", 0);
console.log(p.dump());
