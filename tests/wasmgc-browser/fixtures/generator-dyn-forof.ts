// @known-defect(engine): engine dyn cannot marshal a class value (the Bag class reached by the dyn class-keys helper) to JavaScript; the generator itself now crosses as a facade
// @known-defect-expect: compile: marshalling classval to JavaScript
class Bag {
  items: string[] = ["a", "b", "c"];
  *[Symbol.iterator](): Generator<string> {
    for (const it of this.items) yield it;
  }
}
const bag = new Bag();
for (const x of bag[Symbol.iterator]()) console.log(x);
