const t = (f) => { try { return f(); } catch (e) { return e.name + ": " + e.message; } };
export function sym() { return Symbol.for("x"); }
export function run(s) { return [t(() => `${s}`), t(() => "a" + s), t(() => String(s)), t(() => s.toString()), t(() => s.description), t(() => `${[1, null]}|${undefined}|${{}}`)].join(" | "); }
