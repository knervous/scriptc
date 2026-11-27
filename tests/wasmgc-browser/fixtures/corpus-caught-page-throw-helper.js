export function caughtIdentity() {
  const out = [];
  const reason = { message: "cancelled" };
  for (const v of [reason, [1, 2], 7, 2.5, "t", true, null]) {
    const c = new AbortController();
    c.abort(v);
    try { c.signal.throwIfAborted(); out.push("none"); } catch (e) { out.push(String(e === v) + ":" + typeof e); }
  }
  return out.join(" ");
}
