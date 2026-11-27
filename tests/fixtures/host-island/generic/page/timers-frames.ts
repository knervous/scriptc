// @unordered: the frame callback and the third interval tick race on the wall clock (16.7 ms grid vs 15 ms).
const list = document.createElement("ul");
list.id = "items";
document.body.appendChild(list);
for (let i = 0; i < 3; i++) {
  const li = document.createElement("li");
  li.textContent = `item ${i}`;
  li.className = i === 1 ? "picked" : "plain";
  list.appendChild(li);
}
const found = document.getElementById("items");
console.log("found", found === list, list.children.length, document.querySelector(".picked")!.textContent);
const log = console.log;
log("method as value", typeof log);
let clicks = 0;
list.addEventListener("click", (e: Event) => { clicks++; console.log("list heard", e.type, clicks); });
const second = list.children[1] as HTMLElement;
second.addEventListener("click", () => console.log("item heard"));
second.click();
list.removeChild(second);
console.log("after remove", list.children.length, list.textContent);
const t0 = performance.now();
let ticks = 0;
const iv = setInterval(() => {
  ticks++;
  console.log("interval", ticks);
  if (ticks === 3) clearInterval(iv);
}, 5);
const cancelled = setTimeout(() => console.log("never"), 1);
clearTimeout(cancelled);
setTimeout((a: number, b: string) => console.log("timeout args", a, b, performance.now() - t0 >= 20), 20, 7, "x");
requestAnimationFrame((ts: number) => console.log("frame", ts > 0));
console.log("top level done");
