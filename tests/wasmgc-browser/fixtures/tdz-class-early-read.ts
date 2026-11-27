// @refuse: before its declaration runs
// A class named by code that runs before its declaration is a ReferenceError in Node. Classes have no checked form of that: refused.
function makeWidget(): object {
  return new Widget();
}
try {
  console.log(typeof makeWidget());
} catch (e) {
  console.log((e as Error).name);
}
class Widget {
  tag = "w";
}
console.log(typeof makeWidget());
