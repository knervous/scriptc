// @native-any-only: TS object literals with no contextual type are typed records of their own shape under native-any
// A literal built where no contextual type applies (pushed into an `any` array,
// immer's draft.todos.push({...})) is a typed record of its own shape; read back
// into a typed slot it converts field by field, as a plain object would.
interface Tag { name: string; weight: number }
interface Todo { id: number; title: string; tags: Tag[] }
const first: any = { id: 7, title: "t" };
const list: any = [];
list.push({ id: first.id, title: first.title, tags: [{ name: "r", weight: 1 }] });
list.push({ title: "second", id: 8, tags: [] });
// (Read before the typed view: a dynamic list converted to Todo[] is a copy, so the compiler fences any read of
// `list` after the conversion; agent RT 10-28, the owner's alias rule.)
const hasLen = Object.prototype.hasOwnProperty.call(list, "length") && Object.prototype.hasOwnProperty.call("ab", "1");
const todos: Todo[] = list;
let sum = 0;
for (const t of todos) sum += t.id + t.title.length + t.tags.length;
console.log(sum, todos[0]!.tags[0]!.name, todos[1]!.title);
console.log(hasLen);
