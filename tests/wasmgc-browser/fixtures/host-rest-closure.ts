// @options: {"hostHandles": true}
// @known-defect(engine): the engine lane has no array representation for unknown elements (a rest of unknown)
// @known-defect-expect: compile: 'unknown' elements have no array representation yet
// A compiled function with a rest parameter handed to the host as a callback (setTimeout's extra arguments reach it
// as the rest). Same output as Node.
const handler: (...args: Array<unknown>) => void = (...args) => { console.log(args.length, args.join(",")); };
setTimeout(handler, 0, 1, "two");
