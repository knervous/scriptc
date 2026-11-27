// JS classes the program never iterates: the backend's class bridge still calls
// the lifted %dyn.class.properties helper, which no IR call reaches.
const seen = [];
class Base { copy(value = 1) { return value; } }
class Child extends Base { copy(value) { seen.push("child " + value); return value; } }
function visit(value) { return value.copy(3); }
export function run() {
  const child = new Child();
  const out = [child.copy(2), new Base().copy(), visit(child)];
  return out.join("|") + " " + seen.join(",");
}
