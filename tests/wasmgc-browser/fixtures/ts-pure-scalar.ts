function square(x: number): number { return x * x; }
function composed(x: number): number { return square(x) + 1; }
function logged(x: number): number { console.log('kept', x); return x; }
function recurse(x: number): number { return x ? recurse(x - 1) : 0; }
let events = '';
function argument(x: number): number { events += String(x); return x; }
square(argument(2));
composed(argument(3));
logged(4);
recurse(3);
console.log(events, composed(5));
function throwing(): number { throw new Error('argument'); }
try { square(throwing()); } catch { console.log('caught'); }
