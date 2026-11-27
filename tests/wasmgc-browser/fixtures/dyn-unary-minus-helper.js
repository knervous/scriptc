const t = (f) => { try { return String(f()); } catch (e) { return e.name + ": " + e.message; } };
export function negate(o) { return [t(() => -o), t(() => Object.is(-o, -0)), t(() => o * 2)].join(" "); }
export function run() { return [{ valueOf() { return 3; } }, [5], "4", null, undefined, true, 0, "x"].map(negate).join("\n"); }
