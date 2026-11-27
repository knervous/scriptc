// Page values for the for-of fixture.
export function pageList() { return { entries: [7, 8, 9] }; }
export function pageSet() { return globalThis.Set ? new globalThis.Set(["s", "t"]) : []; }
