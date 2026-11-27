// @native-only: a page-backed record crosses to the page as its page object only under the native object model
// A member call on a page object seen through our own interface binds `this` to that object, as JS does: a
// method inherited from the page type (`addEventListener` on `interface HidLike extends EventTarget`, the
// client's WebHID facade) and a method the interface declares (`abort()` on an AbortController) both run the
// page's prototype function, which throws "Illegal invocation" without its object.
interface Hub extends EventTarget {
  label?: string;
}
interface Ctl {
  abort(reason?: string): void;
  readonly signal: AbortSignal;
}
const hub: Hub = new EventTarget();
const heard: string[] = [];
const onPing = (e: Event): void => { heard.push(e.type); };
hub.addEventListener("ping", onPing);
const maybe = (): Hub | null => hub;
maybe()?.addEventListener("pong", onPing);
hub.dispatchEvent(new Event("ping"));
maybe()?.dispatchEvent(new Event("pong"));
hub.removeEventListener("ping", onPing);
hub.dispatchEvent(new Event("ping"));
console.log(heard.join(","));
const ctl: Ctl = new AbortController();
ctl.abort("done");
console.log(ctl.signal.aborted, String(ctl.signal.reason));
