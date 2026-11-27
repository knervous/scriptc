// @options: {"hostHandles": true}
// Module-level page/number bindings mutated from a listener closure: the
// null test and String(n) still take the typed paths.
let clicks = 0;
let label: EventTarget | null = null;
const out: string[] = [];
function mount(): void { label = new EventTarget(); }
const target = new EventTarget();
target.addEventListener("ping", () => {
  clicks = clicks + 1;
  if (label !== null) out.push(String(clicks));
});
mount();
target.dispatchEvent(new Event("ping"));
target.dispatchEvent(new Event("ping"));
console.log(out.join(","));
