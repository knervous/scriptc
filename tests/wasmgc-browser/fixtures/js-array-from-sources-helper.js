// Array.from over sources it cannot see statically: iterables, strings, array-likes, a mapper, null.
const t = (f) => { try { return f(); } catch (e) { return e.name + ": " + e.message; } };
export function run(set, str, like, it) {
  return [t(() => Array.from(set).join(",")), t(() => Array.from(str).join("|")), t(() => Array.from(like).join(",")),
    t(() => Array.from(it).length), t(() => Array.from(set, (x) => x * 2).join(",")), t(() => Array.from(null))].join(" ; ");
}
