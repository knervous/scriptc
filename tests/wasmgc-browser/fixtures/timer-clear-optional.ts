// clearTimeout / clearInterval of a `number | undefined` handle held in a
// module-level let: an absent handle is ignored, a live one is cleared.
let pending: ReturnType<typeof setTimeout> | undefined;
let ticker: ReturnType<typeof setInterval> | undefined;
let fired = 0;

function schedule(label: string): void {
  if (pending !== undefined) clearTimeout(pending);
  pending = setTimeout(() => {
    fired++;
    console.log("fired", label, fired);
  }, 5);
}

function cancel(): void {
  clearTimeout(pending);
  pending = undefined;
}

clearTimeout(pending);
schedule("first");
schedule("second");
ticker = setInterval(() => console.log("tick"), 1000);
clearInterval(ticker);
ticker = undefined;
clearInterval(ticker);
setTimeout(() => {
  cancel();
  schedule("third");
  cancel();
  setTimeout(() => console.log("done", fired), 20);
}, 20);
