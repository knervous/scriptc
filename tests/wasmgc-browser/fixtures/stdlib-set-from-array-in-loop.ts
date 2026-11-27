// new Set(array) in a loop (fpc experiment B, from client chat-filters normalizeChatTabs): new Set(array) built at one source site on each loop iteration. The WasmGC lane answered
// sizes 2,0,0 (every construction after the first empty) in both release and dev builds (2026-10-26).
const typed: string[][] = [["a", "b", "a"], ["c"], ["d"]];
const lens: number[] = [], sets: number[] = [], idx: number[] = [], inner: string[] = [];
for (const xs of typed) lens.push(xs.length);
for (const xs of typed) sets.push(new Set(xs).size);
for (let i = 0; i < typed.length; i++) idx.push(new Set(typed[i]!).size);
for (const xs of typed) { let t = ""; for (const x of xs) t += x; inner.push(t); }
console.log(`lens ${lens.join(",")} sets ${sets.join(",")} idx ${idx.join(",")} inner ${inner.join("|")}`);
