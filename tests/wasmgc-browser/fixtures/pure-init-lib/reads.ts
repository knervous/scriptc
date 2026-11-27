export const TABLE = Object.freeze({ double: (n: number): number => n * 2, label: "table" });
export const SPARE = Object.freeze({ triple: (n: number): number => n * 3 });
export const BOTH = Object.freeze({ table: TABLE, name: "both" });
export function viaFunction(n: number): number { return TABLE.double(n); }
export const readLater = (): string => BOTH.table.label + ":" + BOTH.name;
