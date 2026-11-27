// @native-only: the legacy engine-dyn lane has no page-value-to-dyn descriptor conversion; the production (native dyn) model does
// @options: {"interfaceClassArms": true}
// A page prototype's own property descriptor: the idiom that assigns through the
// native setter (`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,
// 'value')?.set?.call(input, v)`), plus the absent-key answer.
const setNative = (target: Event, value: boolean): void => {
  Object.getOwnPropertyDescriptor(Event.prototype, "cancelBubble")?.set?.call(target, value);
};
const ev = new Event("ping");
console.log(ev.cancelBubble);
setNative(ev, true);
console.log(ev.cancelBubble);
const d = Object.getOwnPropertyDescriptor(Event.prototype, "cancelBubble");
console.log(typeof d?.get, typeof d?.set, d?.get?.call(ev));
console.log(Object.getOwnPropertyDescriptor(Event.prototype, "noSuchMember") === undefined);
