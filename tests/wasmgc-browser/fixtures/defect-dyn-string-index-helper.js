// JS code indexing a string (a native dyn string under --dyn native).
export function strIndex(s) { const k = "1"; let out = ""; for (let j = 0; j < s.length; j++) out += s[j]; return out + s[k] + s["0"]; }
