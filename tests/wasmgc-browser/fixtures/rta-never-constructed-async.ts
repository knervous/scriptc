// @options: {"hostHandles": true}
// @native-only: native dyn model
// Async methods and method values of a never-constructed class (a method that never reads `this` is lowered receiverless).
class Remote {
  async fetchIt(n: number): Promise<number> { await Promise.resolve(); return n * 2; }
  pure(n: number): number { return n + 1; }
}
async function viaRemote(r: Remote | null): Promise<string> {
  if (r === null) return "no remote";
  const f = r.pure;
  return String(await r.fetchIt(f(2)));
}
viaRemote(null).then((v) => console.log(v));
class Live { pure(n: number): number { return n + 10; } async later(): Promise<number> { return 7; } }
const live = new Live();
const pureFn = live.pure;
live.later().then((v) => console.log(pureFn(v)));
