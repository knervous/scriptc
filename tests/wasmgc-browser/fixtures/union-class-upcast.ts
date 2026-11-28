// A union of classes that share a base flows into a slot of the base class: each arm upcasts, and the value is the same object.
// (A renderer's `Instance | TextInstance` passed to a function of their common node class.)
class Node {
  readonly id: number;
  constructor(id: number) { this.id = id; }
  describe(): string { return `node ${this.id}`; }
}
class Element extends Node {
  readonly tag: string;
  constructor(id: number, tag: string) { super(id); this.tag = tag; }
  describe(): string { return `<${this.tag}> ${this.id}`; }
}
class Text extends Node {
  readonly text: string;
  constructor(id: number, text: string) { super(id); this.text = text; }
}
class Comment extends Text {
  constructor(id: number, text: string) { super(id, text); }
}

function describe(n: Node): string { return n.describe() + (n instanceof Element ? " element" : n instanceof Text ? " text" : ""); }
const seen: Node[] = [];
function keep(n: Node): void { seen.push(n); }

const items: (Element | Text)[] = [new Element(1, "div"), new Text(2, "hi"), new Comment(3, "c")];
for (const item of items) {
  keep(item);
  console.log(describe(item));
}
console.log(seen.length, seen[0] === items[0], seen[2] === items[2], seen[2] instanceof Comment);
function asBase(either: Element | Comment): Node { return either; }
const comment = new Comment(4, "x"), element = new Element(5, "p");
const base = asBase(comment);
console.log(base.describe(), base === comment, describe(asBase(element)), asBase(element) === element);
const second = items[1];
if (second !== undefined) console.log(describe(second));
