type C = { type: "image"; url: string } | { type: "sprite"; url: string; col: number };
function pick(list: C[], i: number): string {
  const c = list[i];
  if (c?.type === "image") return "i" + c.url;
  if (c?.type === "sprite") return "s" + c.col;
  return "n";
}
console.log(pick([{ type: "sprite", url: "u", col: 3 }], 0));
console.log(pick([{ type: "image", url: "u", }], 0));
console.log(pick([], 0));
