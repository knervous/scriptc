// @known-defect(engine,native,native-any): a recursive closure type has no backend representation yet (GcTypes.closureOf recurses through the union of its own result; it needs a rec group) and the engine lane cannot check-cast unknown to a record holding a function field
// A recursive function type (React's scheduler callback: a task returns its own continuation) held in an unknown
// slot and taken back out: the checked conversion answers a type that reaches itself through its result.
type Callback = (didTimeout: boolean) => Callback | null;
let calls = 0;
const step: Callback = (_didTimeout) => {
  calls++;
  return calls < 3 ? step : null;
};
const slot: { v: unknown } = { v: step };
let cb = slot.v as Callback | null;
while (cb !== null) cb = cb(false);
console.log(calls, slot.v === step);
// Mutual recursion through a record: a node whose visitor receives the node.
type Visitor = (node: TreeNode) => Visitor | null;
type TreeNode = { name: string; visit: Visitor | null };
const seen: string[] = [];
const visitor: Visitor = (node) => {
  seen.push(node.name);
  return seen.length < 2 ? visitor : null;
};
const tree: TreeNode = { name: "root", visit: visitor };
const held: unknown[] = [tree];
const back = held[0] as TreeNode;
let v = back.visit;
while (v !== null) v = v(back);
console.log(seen.join(","), back === tree);
