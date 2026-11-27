// Character locals compared only against one-unit literals hold their code unit (ir/char-unit-locals.ts); every
// other use keeps the string. Out-of-range charAt reads "", which is below every one-unit literal.
function classify(s: string, i: number): number {
  const c = s.charAt(i);
  let n = 0;
  if (c === " ") n += 1;
  if (c !== "\t") n += 2;
  if ("a" <= c && c <= "z") n += 4;
  if (c < "0" || c > "9") n += 8;
  if (c <= "A") n += 64;
  if ("Z" > c) n += 128;
  switch (c) {
    case "5": n += 16; break;
    case "\uD83D": n += 256; break;
    default: n += 32;
  }
  return n;
}

function count(s: string): string {
  let letters = 0, spaces = 0, digits = 0, other = 0, high = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c >= "a" && c <= "z") letters++;
    else if (c === " ") spaces++;
    else if (c >= "0" && c <= "9") digits++;
    else if (c >= "\uD800" && c <= "\uDBFF") high++;
    else other++;
  }
  return `${letters} ${spaces} ${digits} ${high} ${other}`;
}

// The local escapes: it stays a string.
function escapes(s: string, i: number): string {
  const c = s.charAt(i);
  return c === " " ? "space" : `[${c}]`;
}

// Compared to a multi-unit string: stays a string.
function multi(s: string, i: number): boolean {
  const c = s.charAt(i);
  return c === "ab" || c < "ba" || c === "x";
}

// Rebound (a let): stays a string.
function rebound(s: string, i: number): boolean {
  let c = s.charAt(i);
  if (c === " ") c = s.charAt(i + 1);
  return c === "x";
}

// A switch with a multi-unit case: stays a string.
function wide(s: string, i: number): number {
  const c = s.charAt(i);
  switch (c) { case "a": return 1; case "bc": return 2; default: return 3; }
}

// Indexes: negative, fractional, NaN, past the end.
const text = "a b5\t😀Z9";
const indexes = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 40, -1, 1.5, NaN];
const out: number[] = [];
for (const i of indexes) out.push(classify(text, i));
console.log(out.join(","));
console.log(count("hello world 42 😀 ok!"), count(""), count("\uDE00\uD83D"));
console.log(escapes("a b", 1), escapes("a b", 0), escapes("a b", 9), multi("ab", 0), multi("x", 0), multi("", 3), rebound(" x", 0), rebound("yx", 0));
console.log(wide("a", 0), wide("bc", 0), wide("q", 0), wide("", 2));
// A string's own [i] past the end (charAt's ""), only tested for equality.
const s = "xy";
let eq = 0;
for (let i = 0; i < 4; i++) { const c = s[i]; if (c === "x") eq += 1; if (c !== "y") eq += 10; }
console.log(eq);
