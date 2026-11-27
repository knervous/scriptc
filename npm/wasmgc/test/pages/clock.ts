/// <reference path="./host-clock.d.ts" />
// A page program calling a typed host module, synchronously and through a promise.
import { label, now, wait } from "host:clock";

const out = document.createElement("p");
out.id = "clock";
const t = now();
out.textContent = `now ${t} ${label(t * 2)}`;
document.body.appendChild(out);
const waited = await wait(3);
out.textContent += `, ${waited}`;
console.log(out.textContent);
document.title = "ready";
