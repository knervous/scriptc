// Optional chains through an any-typed link: present and absent receivers,
// nested links, and the short-circuit's undefined.
class Ent {
  name = "ent";
  spawn = { spawnId: 7 };
}
function idOf(holder: any): any {
  return holder?.entity?.spawn?.spawnId;
}
function nameOf(holder: any): any {
  return holder?.entity?.name;
}
const present: any = { entity: new Ent() };
const absent: any = undefined;
const empty: any = { entity: null };
console.log(idOf(present), idOf(absent), idOf(empty));
console.log(nameOf(present), nameOf(absent), typeof nameOf(empty));
