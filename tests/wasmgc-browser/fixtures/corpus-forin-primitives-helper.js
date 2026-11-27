/** @param {any} value */
export function forInKeys(value) {
  const keys = [];
  for (const key in value) keys.push(key);
  return "[" + keys.join(",") + "]";
}
