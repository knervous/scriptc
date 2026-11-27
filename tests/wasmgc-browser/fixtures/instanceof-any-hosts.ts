// The `any` left side of instanceof against the host-backed and compiled-constructor values: never a folded false.
const d: any = new Date(5), u: any = new URL("http://a.b/"), o: any = {}, n: any = 3;
const out: string[] = [];
out.push("date " + [d instanceof Date, o instanceof Date, n instanceof Date, u instanceof Date].join());
out.push("url " + [u instanceof URL, d instanceof URL, o instanceof URL].join());
console.log(out.join("\n"));
