// Known defect: spreading a class instance and then overriding one of its fields moves that key to
// the end; JavaScript keeps the key at its first position and only replaces the value. (A plain
// object spread keeps the order.)
// @known-defect(engine,native,native-any): spread of a class instance then override of an existing field reorders keys
// @known-defect-expect: stdout: kind,state
type Mode = "a" | "b";
class P { state: Mode = "a"; kind = "k"; }
const copy = { ...new P(), state: "b" as Mode };
console.log(Object.keys(copy).join(","), JSON.stringify(copy));
