// A statement-position optional chain ending in a page method that returns
// nothing (`state?._buffer.destroy()` on a GPUBuffer, `this.device?.removeEventListener(...)`):
// a present receiver runs the call, a nullish one skips it and its arguments.
interface Holder { target: EventTarget }
let hits = 0;
let evaluated = 0;
const onPing = (): void => { hits++; };
function listener(): () => void { evaluated++; return onPing; }
function attach(holder: Holder | null): void {
  holder?.target.addEventListener("ping", listener());
}
function detach(holder: Holder | undefined): void {
  holder?.target.removeEventListener("ping", onPing);
}
const holder: Holder = { target: new EventTarget() };
attach(null);
attach(holder);
holder.target.dispatchEvent(new Event("ping"));
detach(undefined);
detach(holder);
holder.target.dispatchEvent(new Event("ping"));
console.log(hits, evaluated);
