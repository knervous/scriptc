// A typed record behind `any`: the class property dispatch's record guard (dyn.isTypedRecord) and class chains.
class Box { constructor(public label: string, public size: number) {} }
interface Props { label: string; size: number }
function describe(p: any): string { return `${p.label}:${p.size}`; }
const props: Props = { label: "rec", size: 2 };
const box = new Box("box", 5);
console.log(describe(props), describe(box), describe({ label: "lit", size: 9 }));
function setLabel(p: any, v: string): void { p.label = v; }
setLabel(box, "box2"); setLabel(props, "rec2");
console.log(box.label, props.label);
