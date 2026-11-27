import { describe, expect, test } from "vitest";
import { memorySpan, moduleAddress } from "./address.js";

describe("module-memory addresses", () => {
  test("an i32 reads as the unsigned address it carries", () => {
    expect(moduleAddress(0)).toBe(0);
    expect(moduleAddress(0x7fffffff)).toBe(2147483647);
    expect(moduleAddress(-2147483648)).toBe(0x80000000);
    expect(moduleAddress(0x80000000 | 0)).toBe(2147483648);
    expect(moduleAddress(-1)).toBe(0xffffffff);
  });
  test("a span straddling 2 GiB stays contiguous", () => {
    expect(memorySpan(0x7ffffffc | 0, 8, 0x90000000)).toEqual({ start: 0x7ffffffc, end: 0x80000004 });
    expect(memorySpan(0x80000000 | 0, 16, 0x90000000)).toEqual({ start: 0x80000000, end: 0x80000010 });
  });
  test("a span past the buffer, or with a bad length, is refused", () => {
    expect(() => memorySpan(0x80000000 | 0, 16, 0x80000008)).toThrow(RangeError);
    expect(() => memorySpan(-1, 2, 0xffffffff)).toThrow(/4294967295\+2/);
    expect(() => memorySpan(0, -1, 16)).toThrow(RangeError);
    expect(() => memorySpan(0, 1.5, 16)).toThrow(RangeError);
  });
});
