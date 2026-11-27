// @native-any-only: a caught value flowing out of its binding as `any` keeps its class members only where TS any is native
// A caught value cast `as any` into a variable, then read for name/message/own fields/methods.
class AppError extends Error { code = 7; constructor(m: string) { super(m); this.name = "AppError"; } describe() { return `${this.name}#${this.code}`; } }
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
function castAny(k: number): string {
  try { thrower(k); return "none"; } catch (e) { const x = e as any; return `${x?.name}|${x?.message}`; }
}
for (let k = 0; k < 9; k++) console.log(k, castAny(k));
function members(): string {
  try { thrower(3); return "none"; } catch (e) { const x = e as any; return `${x.code}|${x.describe()}|${x instanceof AppError}`; }
}
console.log(members());
