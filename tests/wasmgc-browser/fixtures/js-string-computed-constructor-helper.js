const readKey = (o, k) => o[k];
export function probe(s, k) { try { return typeof readKey(s, k); } catch (e) { return `${e.name} ${e.message}`; } }
