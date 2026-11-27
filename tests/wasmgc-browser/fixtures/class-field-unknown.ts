// Unknown-typed class fields on the browser target: declared, assigned in
// the constructor and later, read back and narrowed; an object-typed token.
class Handle {
  readonly extras: Readonly<Record<string, unknown>>;
  readonly token: object;
  payload: unknown = undefined;
  constructor(extras: Readonly<Record<string, unknown>>, token: object) {
    this.extras = extras;
    this.token = token;
  }
}
const token = { id: 7 };
const h = new Handle({ name: "torch", lit: true, size: 3 }, token);
const name = h.extras["name"];
console.log(typeof name === "string" ? name.toUpperCase() : "?", h.extras["size"] === 3, h.token === token);
h.payload = [1, 2, 3];
console.log(Array.isArray(h.payload) ? h.payload.length : -1);
h.payload = "text";
console.log(typeof h.payload, h.payload === "text");
