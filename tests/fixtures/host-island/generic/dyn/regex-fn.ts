// s.replace(re, fn) / s.replaceAll(re, fn) with a function replacement (regex replaceFn / replaceAllFn).
function swap(text: string, re: RegExp, all: boolean): string {
  const fn = (match: string, ...rest: unknown[]): string => `[${match.toUpperCase()}:${rest.slice(0, -2).join("|")}@${String(rest[rest.length - 2])}]`;
  return all ? text.replaceAll(re, fn) : text.replace(re, fn);
}
console.log(swap("a1 b22 c333", /([a-z])(\d+)/g, false));
console.log(swap("a1 b22 c333", /([a-z])(\d+)/, false));
console.log(swap("héllo wörld", /ö|é/g, true));
console.log(swap("none here", /\d/g, false));
try { console.log(swap("x1", /\d/, true)); } catch (error) { console.log(error instanceof TypeError, (error as Error).message); }
let calls = 0;
console.log("aaa".replace(/a/g, () => String(++calls)), calls);
try { "boom".replace(/o/g, () => { throw new Error("from callback"); }); } catch (error) { console.log((error as Error).message); }
