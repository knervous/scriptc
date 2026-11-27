// @known-defect(engine,native,native-any): a function cast to a record (`fn as unknown as Record<string, T>`) has no record to write a keyed property into; it must refuse cleanly, never reach the backend as a func receiver
// @known-defect-expect: compile: keyed writes through a cast to a record type the value is not
const TAG = "@@TAG@@";
export function make(): number { return 16; }
(make as unknown as Record<string, true>)[TAG] = true;
console.log(make());
