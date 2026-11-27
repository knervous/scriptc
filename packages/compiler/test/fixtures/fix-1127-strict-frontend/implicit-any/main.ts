// Implicit `any` (an unannotated parameter, an unannotated `let`) reaches the lowering as a dynamic value; explicit `any`
// is the author's choice and passes the trap.
function add(a, b: number): number {
  return a + b;
}
let later;
later = 4;
const explicit: any = 3;
const cast = ("5" as any) as string;
console.log(add(1, 2), later, explicit + 1, cast);
