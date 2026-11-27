// @native-only: the engine dyn model reads an exposed field through a page cast of `this` and fails inside the constructor
// A function-valued field initializer only creates the closure: it exposes nothing, so the field stays a plain callable and
// `?.` calls and awaits on it keep their types. A closure called during construction still exposes the unassigned fields.
class Bindings {
  private readonly cache = new Map<string, number>();
  getFile = async (name: string): Promise<ArrayBuffer | null> => {
    try { return new ArrayBuffer(name.length + this.cache.size); } catch { return null; }
  };
}
const bindings = new Bindings();
async function bytesOf(name: string): Promise<ArrayBuffer | undefined> {
  let buffer: ArrayBuffer | undefined;
  const bytes = await bindings.getFile?.(name);
  if (bytes) buffer = bytes;
  return buffer;
}
class Early {
  total: number;
  step = () => this.total + 1;
  constructor() {
    this.total = 1;
    this.total = this.step();
  }
}
class Exposed {
  seen: string;
  peek = (): string => typeof this.seen;
  constructor() {
    console.log(this.peek());
    this.seen = "x";
    console.log(this.peek());
  }
}
class Counter {
  level: number;
  constructor() { this.init(); this.level = 3; }
  init(): void { console.log(typeof (this as { level?: number }).level); }
}
bytesOf("abc").then((b) => {
  console.log(b?.byteLength, new Early().total);
  new Exposed();
  const c = new Counter();
  c.level += 2;
  c.level++;
  console.log(c.level);
});
