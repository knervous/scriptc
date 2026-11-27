// @native-only: the engine lane reads the class receiver as null after its awaits ("'dispose' in null"), pre-existing and the same with .then(undefined, h); the client is native
// An inline `.catch` arrow reading the enclosing method's `this`: the handler body lowers inline in the catch wrapper,
// which did not inherit `this` on the browser target ("'this' outside a class method"), while `.then(undefined, arrow)`
// and `.finally(arrow)` compiled (the volumetric fog's rebind chain).
class Fog {
  private disposed = false;
  private log: string[] = [];
  private rebinding: Promise<void> | null = null;
  private readonly name: string;
  constructor(name: string) { this.name = name; }
  private async rebind(fail: boolean): Promise<void> {
    await Promise.resolve();
    if (fail) throw new Error(`${this.name} rebind`);
  }
  schedule(fail: boolean): Promise<void> {
    this.rebinding = this.rebind(fail)
      .catch((error: unknown) => {
        if (!this.disposed) this.log.push(`${this.name}: ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => {
        this.rebinding = null;
      });
    return this.rebinding;
  }
  count(p: Promise<number>): Promise<number> {
    return p.catch(() => this.log.length);
  }
  dispose(): void { this.disposed = true; }
  get lines(): string { return this.log.join(" | "); }
  get pending(): boolean { return this.rebinding !== null; }
}
async function main(): Promise<void> {
  const fog = new Fog("crypt");
  await fog.schedule(true);
  await fog.schedule(false);
  fog.dispose();
  await fog.schedule(true);
  console.log(fog.lines, fog.pending);
  console.log(await fog.count(Promise.reject(new Error("x"))), await fog.count(Promise.resolve(7)));
}
void main();
