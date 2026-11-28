// A compiled callback the page calls (an event listener's shape) that queues a microtask and schedules a timer:
// both run after the page's call returns, as React's discrete-event flush and its scheduler need. Once from a
// compiled timer, once from the page's own timer (outside any compiled call, as the browser dispatches an event).
const page: any = globalThis;
let round = "compiled";
page.auditAdd(() => {
  const r = round;
  queueMicrotask(() => console.log(r, "microtask"));
  Promise.resolve().then(() => console.log(r, "then"));
  setTimeout(() => console.log(r, "timer"), 0);
  console.log(r, "listener");
});
setTimeout(() => {
  page.auditFire();
  console.log("fired");
  round = "page";
  setTimeout(() => page.auditFireLater(), 5);
}, 0);
