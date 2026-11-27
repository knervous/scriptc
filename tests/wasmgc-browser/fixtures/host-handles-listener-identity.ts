// @options: {"hostHandles": true}
// A compiled closure handed to page code twice is the same page function, so
// removeEventListener finds the listener addEventListener registered.
const target = new EventTarget();
let hits = 0;
const onPing = (e: Event): void => { hits++; void e.type; };
target.addEventListener("ping", onPing);
target.dispatchEvent(new Event("ping"));
target.removeEventListener("ping", onPing);
target.dispatchEvent(new Event("ping"));
console.log(hits);
