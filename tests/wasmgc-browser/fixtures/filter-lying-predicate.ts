// @profile: a written '.filter' type predicate is a checked narrowing: an element the predicate keeps that is not the asserted type throws a catchable TypeError at the filter (JS would keep the mistyped element)
// @expect: kept 2
// @expect: threw true
const values: (number | string)[] = [1, 2, "three"];
const honest = values.filter((v): v is number => typeof v === "number");
console.log("kept", honest.length);
try {
  const lying = values.filter((v): v is number => v !== 1);
  console.log("no throw", lying.length);
} catch (e) {
  console.log("threw", e instanceof TypeError);
}
export {};
