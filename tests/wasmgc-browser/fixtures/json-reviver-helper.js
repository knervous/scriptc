// JSON.parse with a reviver (InternalizeJSONProperty), through the JSON value and by direct call.
/** @type {any} */ var J = JSON;
export function run() {
  var out = [], log = [];
  var text = '{"a":1,"b":[10,20,{"c":"x"}],"d":{"e":null,"f":true},"g":"s"}';
  /** @type {any} */
  var rev = function (key, value) { log.push(key + "=" + (typeof value === "object" && value !== null ? "obj" : String(value))); return typeof value === "number" ? value * 2 : value; };
  out.push(JSON.stringify(J.parse(text, rev)), log.join(","));
  log = [];
  out.push(JSON.stringify(J.parse(text, function (key, value) { if (key === "a" || key === "1" || key === "e") return undefined; return value; })));
  var holders = [];
  J.parse('{"x":{"y":1}}', function (key, value) { holders.push(key + ":" + (this === undefined ? "u" : Object.keys(this).join("+"))); return value; });
  out.push(holders.join("|"));
  out.push(JSON.stringify(J.parse("[1,2,3]", function (k, v) { return Array.isArray(v) ? v.length : v + 1; })));
  out.push(JSON.stringify(J.parse("5", function (k, v) { return v + k + "!"; })), typeof J.parse('"t"', function (k, v) { return undefined; }));
  out.push(JSON.stringify(J.parse(text, null)), JSON.stringify(J.parse(text, undefined)), JSON.stringify(J.parse(text, 5)));
  out.push(JSON.stringify(JSON.parse('{"p":[1,{"q":2}]}', function (k, v) { return typeof v === "number" ? v + 100 : v; })));
  try { J.parse("[1,2]", function (k, v) { if (v === 2) throw new RangeError("boom"); return v; }); out.push("no throw"); } catch (e) { out.push(e.name + ":" + e.message); }
  try { J.parse("{bad", rev); } catch (e) { out.push(e.name); }
  out.push(typeof J.parse, J.parse.length, J.parse.name);
  return out.join("\n");
}
