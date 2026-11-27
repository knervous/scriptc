export function arrayKey() { const arr = ["a", [1, 2]]; const k = /** @type {any} */ (arr[1]); const o = { [k]: 1 }; return typeof k + " " + Array.isArray(k) + " " + String(k) + " " + o["1,2"]; }
