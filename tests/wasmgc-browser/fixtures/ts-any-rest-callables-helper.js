export function callIt(f) { return [f(), f(1), f(1, 2, 3, 4, 5, 6)].join(","); }
