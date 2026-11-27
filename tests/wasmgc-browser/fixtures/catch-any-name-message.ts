// Reading .name / .message off a caught value typed any, or cast with `as any`, for every kind of thrown value.
class AppError extends Error { constructor(m: string) { super(m); this.name = "AppError"; } }
function thrower(k: number): never {
  switch (k) {
    case 0: throw new Error("plain");
    case 1: throw new TypeError("typed");
    case 2: throw new RangeError("ranged");
    case 3: throw new AppError("custom");
    case 4: throw "a string";
    case 5: throw 42;
    case 6: throw { name: "objName", message: "objMessage" };
    case 7: throw undefined;
    case 8: throw null;
    default: throw new Error("default");
  }
}
function declaredAny(k: number): string {
  try { thrower(k); return "none"; } catch (e: any) { return `${e?.name}|${e?.message}`; }
}
function castInline(k: number): string {
  try { thrower(k); return "none"; } catch (e) { return `${(e as any)?.name}|${(e as any)?.message}`; }
}
function castUnknown(k: number): string {
  try { thrower(k); return "none"; } catch (e: unknown) { return `${(e as Error).name}|${(e as Error).message}`; }
}
for (let k = 0; k < 9; k++) {
  console.log(k, declaredAny(k), castInline(k));
}
for (let k = 0; k < 4; k++) console.log(k, castUnknown(k));
try { JSON.parse("{"); } catch (e: any) { console.log(e.name, typeof e.message); }
try { (undefined as any).x; } catch (e) { console.log((e as any).name); }
