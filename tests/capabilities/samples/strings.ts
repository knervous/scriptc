function work(n: number): number {
  let h = 0;
  let s = "";
  for (let i = 0; i < n; i++) {
    s = s.length > 64 ? s.substring(32) : s;
    s = s + String.fromCodePoint(97 + (i % 26));
    for (let j = 0; j < s.length; j++) h = (h * 31 + s.charCodeAt(j)) | 0;
    if (s === "abc") h++;
  }
  return h;
}
// node-stage.mjs reports the run time; the output itself is deterministic.
console.log("result", work(300000));
