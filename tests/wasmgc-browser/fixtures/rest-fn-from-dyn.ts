// @known-defect(engine): the engine lane has no array representation for unknown elements (a rest of unknown)
// @known-defect-expect: compile: 'unknown' elements have no array representation yet
// A function held in an unknown slot taken back out as a rest signature (React's useEffectEvent: `(...args) =>
// unknown`), called with several arguments and none; and a rest function boxed into unknown and called back the
// same way. Same output as Node.
type EventFunction = (...args: Array<unknown>) => unknown;
const slots: { [key: string]: unknown } = {};
slots.pair = (a: unknown, b: unknown) => `${a}-${b}`;
slots.count = (...args: Array<unknown>) => args.length;
const pair = slots.pair as EventFunction;
const count = slots.count as EventFunction;
console.log(pair(1, 2), pair("x"), count(), count(1, 2, 3));
