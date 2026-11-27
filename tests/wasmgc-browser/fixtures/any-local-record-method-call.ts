// @native-any-only: a method call on an `any` local that holds a record (React's `const dispatcher: any = ReactSharedInternals.H; dispatcher.useState()`).
type Dispatcher = { useState(initial: unknown): [unknown, number]; useThing: (n: number) => number; name: string };
type Shared = { H: Dispatcher | null };
const D: Dispatcher = { useState(initial: unknown) { return [initial, 1]; }, useThing: (n) => n + 1, name: "d" };
const shared: Shared = { H: D };
const dispatcher: any = shared.H;
const [v, n] = dispatcher.useState(5);
console.log(v, n, dispatcher.useThing(2), dispatcher.name);
shared.H = null;
const none: any = shared.H;
try { none.useState(1); } catch (e) { console.log("TypeError", e instanceof TypeError); }
