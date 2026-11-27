// Atomics on compiled integer typed arrays (review §19/§21: wasm atomic
// instructions on the array's storage). Every result must match Node: value
// wrapping per element kind, return values, ToIndex, and the RangeError.
const lines: string[] = [];
const i8 = new Int8Array(4), u8 = new Uint8Array(4), i16 = new Int16Array(4), u16 = new Uint16Array(4), i32 = new Int32Array(4), u32 = new Uint32Array(4);

lines.push(`store ${Atomics.store(i8, 0, 130)} ${Atomics.store(u8, 0, -1)} ${Atomics.store(i16, 0, 40000)} ${Atomics.store(u16, 0, -2)} ${Atomics.store(i32, 0, 4294967297)} ${Atomics.store(u32, 0, -3)}`);
lines.push(`store returns ToIntegerOrInfinity ${Atomics.store(i32, 1, 3.7)} ${Atomics.store(i32, 1, -0.5)} ${Atomics.store(i32, 1, NaN)}`);
lines.push(`load ${Atomics.load(i8, 0)} ${Atomics.load(u8, 0)} ${Atomics.load(i16, 0)} ${Atomics.load(u16, 0)} ${Atomics.load(i32, 0)} ${Atomics.load(u32, 0)}`);
lines.push(`add ${Atomics.add(i8, 0, 127)} -> ${i8[0]}; ${Atomics.add(u8, 0, 2)} -> ${u8[0]}; ${Atomics.add(u32, 0, 5)} -> ${u32[0]}`);
lines.push(`sub ${Atomics.sub(i16, 0, 1)} -> ${i16[0]}; ${Atomics.sub(u16, 1, 1)} -> ${u16[1]}`);
i32[2] = 0b1100;
lines.push(`and ${Atomics.and(i32, 2, 0b1010)} -> ${i32[2]}; or ${Atomics.or(i32, 2, 0b0101)} -> ${i32[2]}; xor ${Atomics.xor(i32, 2, 0b1111)} -> ${i32[2]}`);
lines.push(`exchange ${Atomics.exchange(u8, 1, 300)} -> ${u8[1]}; ${Atomics.exchange(i32, 3, -7)} -> ${i32[3]}`);
// compareExchange compares in the element's width: -1 matches a stored 255 in a Uint8Array.
u8[2] = 255;
lines.push(`cmpxchg ${Atomics.compareExchange(u8, 2, -1, 9)} -> ${u8[2]}; miss ${Atomics.compareExchange(u8, 2, 8, 1)} -> ${u8[2]}`);
i8[3] = -5;
lines.push(`cmpxchg i8 ${Atomics.compareExchange(i8, 3, 251, 6)} -> ${i8[3]}; i32 ${Atomics.compareExchange(i32, 3, -7, 70)} -> ${i32[3]}`);
lines.push(`index ToIndex ${Atomics.load(i32, 3.9)} ${Atomics.load(i32, NaN)}`);
lines.push(`notify with no waiters ${Atomics.notify(i32, 0)} ${Atomics.notify(i32, 0, 1)}`);
try { Atomics.load(i32, 4); lines.push("no throw"); } catch (e) { lines.push(`out of range: ${(e as Error).name}: ${(e as Error).message}`); }
try { Atomics.add(u8, -1, 1); lines.push("no throw"); } catch (e) { lines.push(`negative: ${(e as Error).name}`); }
// A subarray: atomics address the view's own storage offset.
const sub = i32.subarray(2);
Atomics.store(sub, 1, 99);
lines.push(`subarray ${i32[3]} ${Atomics.load(sub, 0)}`);
console.log(lines.join("\n"));
