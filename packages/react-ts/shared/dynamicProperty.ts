/**
 * A property read or write whose key is known only at run time, JavaScript's `object[key]` (the typed port's
 * stand-in for React's `(x: any)[key]`). The value is `unknown`; callers narrow it.
 */
type PropertyBag = {
    [key: string]: unknown;
};
export function readProperty(target: object, key: string): unknown {
    return (target as PropertyBag)[key];
}
export function writeProperty(target: object, key: string, value: unknown): void {
    (target as PropertyBag)[key] = value;
}
/**
 * WebIDL's DOMString conversion of a value passed to a DOM setter or method (what the JavaScript build hands the
 * DOM as is): ToString, which throws for a Symbol.
 */
export function toDOMString(value: unknown): string {
    if (typeof value === 'symbol') {
        throw new TypeError('Cannot convert a Symbol value to a string');
    }
    return String(value);
}
/**
 * WebIDL's numeric conversion of a value passed to a DOM setter (`unsigned long size`): ToNumber, which throws for a
 * Symbol or a BigInt. The setter applies the integer conversion to the number.
 */
export function toDOMNumber(value: unknown): number {
    if (typeof value === 'symbol') {
        throw new TypeError('Cannot convert a Symbol value to a number');
    }
    if (typeof value === 'bigint') {
        throw new TypeError('Cannot convert a BigInt value to a number');
    }
    return Number(value);
}
