class K { constructor() { this.k = 1; } }
function Fake() {}
export function run() {
  var out = [Reflect.construct(K, []).k, Reflect.construct(K, [], K).k];
  try { out.push(Reflect.construct(K, [], Fake).k); } catch (e) { out.push(e.name + ": " + e.message); }
  return out.join("|");
}
