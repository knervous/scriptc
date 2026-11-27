// Module-level `let` initialisers survive every update form.
let a = 1; const A: number[] = []; A.push(a++); A.push(a++);
let b = 7; const B: number[] = []; for (let i = 0; i < 2; i++) B.push(b++);
let c = 3; c += 1;
let d = 2; const D: number[] = []; while (D.length < 2) D.push(++d);
let e = 4; const E: number[] = []; while (E.length < 2) E.push(e--);
let f = 9; function bump(): number { return f++; }
const F = [bump(), bump()];
console.log(A.join(","), B.join(","), c, D.join(","), E.join(","), F.join(","));
