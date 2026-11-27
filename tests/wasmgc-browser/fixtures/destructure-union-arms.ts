// @options: {"interfaceClassArms": true}
// Object destructuring of a source held as one of several shapes (an
// interface's class arms): each binding is the per-arm read, a default
// applies where the held shape leaves an optional field unset, and a `let`
// binding is an independent copy.
interface Point { x: number; y: number; z: number }
interface Actor extends Point { name: string }
interface Lines { lines: number[][]; colors?: string[] }
interface ColoredLines extends Lines { colors: string[]; width: number }
function sum(game: Point): number { let { x, y, z } = game; x += 1; return x + y + z; }
function count(options: Lines): string { const { lines, colors = ["none"] } = options; return `${lines.length}:${colors.join(",")}`; }
const actor: Actor = { x: 1, y: 2, z: 3, name: "a" };
console.log(sum(actor), sum({ x: 0, y: 0, z: 1 }));
const colored: ColoredLines = { lines: [[1], [2]], colors: ["red"], width: 2 };
console.log(count(colored), count({ lines: [[0]] }));
