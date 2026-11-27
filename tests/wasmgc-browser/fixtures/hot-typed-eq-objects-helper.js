// Receivers of `r.id === k` that are not the record declaring `id: number`:
// native objects of several layouts (the site cache sees each), an accessor,
// an inherited key, a missing key, and a page object.
function Inherits() {}
Inherits.prototype.id = 1;
export function objects() {
  return [{ id: 1, v: 1 }, { v: 2, id: 1 }, { id: NaN }, { id: -0 }, { id: "1" }, { id: 2.5 },
    { get id() { return 1; } }, new Inherits(), { x: 1 }, JSON.parse('{"id":1}')];
}
