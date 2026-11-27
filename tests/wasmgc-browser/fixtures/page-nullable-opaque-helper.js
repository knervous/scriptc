let held;
export function keep(value) { held = value; }
export function take() { return held; }
export function kindOf(value) { return value === null ? "null" : value === undefined ? "undefined" : typeof value; }
