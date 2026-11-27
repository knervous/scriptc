// A page value compared with null, and String(n) of a number crossing to page
// code: null tests are exact (undefined is not null), numbers format as JS.
declare global { var __maybe: unknown; }
const target = new EventTarget();
let slot: EventTarget | null = null;
const results: string[] = [String(slot === null)];
slot = target;
results.push(String(slot !== null), String(slot === null));
const n = 0.1 + 0.2;
const span: { textContent: string | null } = { textContent: null };
const label = String(n);
span.textContent = String(-0) + "|" + String(1e21) + "|" + label;
console.log(results.join(","), span.textContent, String(NaN), String(Infinity));
export {};
