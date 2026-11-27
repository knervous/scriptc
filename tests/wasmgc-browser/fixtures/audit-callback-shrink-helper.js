// find/findIndex read every index below the length at entry (Get, not
// HasProperty): indices past a shrunk array are visited as undefined.
// Direct loops (statically known closures) and the generic walk (a bound
// function, a page function) must agree.
export function shrinkWalks(pageId) {
  const out = [];
  const mk = () => JSON.parse("[1, 2, 3, 4]");
  let a = mk(), seen = [];
  a.find((x) => { seen.push(x); a.pop(); return false; }); out.push("find:" + seen.join("/"));
  a = mk(); seen = [];
  out.push("findIndex:" + a.findIndex((x, i) => { seen.push(i + "=" + x); a.pop(); return x === undefined; }) + ":" + seen.join("/"));
  a = mk(); seen = [];
  const bound = function (x) { seen.push(x); a.length = 1; return false; }.bind(null);
  a.find(bound); out.push("findBound:" + seen.join("/"));
  a = mk(); seen = [];
  out.push("findIndexBound:" + a.findIndex(function (x) { seen.push(x); a.length = 2; return x === undefined; }.bind(null)) + ":" + seen.join("/"));
  a = mk();
  out.push("findPage:" + String(a.find(pageId)));
  a = mk(); seen = [];
  a.forEach((x) => { seen.push(x); a.pop(); }); out.push("forEach:" + seen.join("/"));
  a = mk(); seen = [];
  a.some((x) => { seen.push(x); a.length = 1; return false; }); out.push("some:" + seen.join("/"));
  a = mk(); seen = [];
  out.push("every:" + a.every((x) => { seen.push(x); a.shift(); return true; }) + ":" + seen.join("/"));
  a = mk(); seen = [];
  out.push("filter:" + a.filter((x) => { seen.push(x); a.pop(); return true; }).join("/") + ":" + seen.join("/"));
  a = mk(); seen = [];
  a.find((x, i) => { seen.push(x); if (i === 0) a.push(9); return false; }); out.push("findGrow:" + seen.join("/"));
  return out.join("\n");
}
