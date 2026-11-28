# @scriptc/types

Contract types for scriptc: type aliases with no meaning in TypeScript or Node.js that scriptc checks as extra promises. Import them with `import type`, which TypeScript erases, so Node.js never loads this package.

```ts
import type { Immutable, Int32, NoThrow } from "@scriptc/types";

const KEYWORDS: Immutable<Map<string, number>> = new Map([["const", 1]]);

class Token {
  pos: Int32 = 0;
}

function isLetter(ch: number): NoThrow<boolean> {
  return (ch >= 97 && ch <= 122) || (ch >= 65 && ch <= 90);
}
```

## Contracts

- `NoThrow<T>` on a function's return type: the function never throws. Callers need no exception checks.
- `Int32` on a parameter, variable, class instance field or function result: every stored value is a signed 32-bit integer by construction (an integer literal in range, a bitwise result such as `x | 0`, `Math.imul`, another `Int32`, a string or array length, or arithmetic scriptc can bound). The slot is stored as a 32-bit integer.
- `Uint32`, `Int8`, `Uint8`, `Int16`, `Uint16`: the same check for their ranges. As class instance fields the 8- and 16-bit types are stored packed (one or two bytes on WasmGC).
- `Int64`, `Uint64` on a bigint slot: every stored value is a 64-bit integer by construction (an in-range literal, `BigInt.asIntN(64, x)` / `BigInt.asUintN(64, x)`, another slot of the type, or a 64-bit result of the int intrinsic library, `scriptw/int`).
- `Int32[]` (also `readonly Int32[]`, `Array<Int32>`) on a parameter, variable, class instance field or function result of type `number[]`: every element stored into the array, through any reference, is an int32 by construction. Element reads that find a value are int32s, so integer arithmetic over them runs in 32-bit operations; holes and missing indices still read as `undefined`.
- `Immutable<T>` on a parameter, variable, class instance field or function result: a deep read-only view, and no code writes to the value through any reference. A module constant built from literals becomes immortal data.
- `Acyclic` on a class (`class C implements Acyclic`), interface (`interface I extends Acyclic`) or object type alias (`type T = Acyclic<{ ... }>`): no chain of references can lead from such an object back to itself. Its objects carry no cycle-collector header.
- `ProgramLifetime` in a class's `implements` clause: instances of the class and its subclasses are never freed, so scriptc skips reference counting and cycle collection for them. Memory only: discarded instances are not reclaimed.

A contract counts only where it is written as one of the annotations above. Anywhere else (a type alias, an interface member, a union such as `Int32 | undefined`, an array of an integer type other than `Int32`) it is reported (SC7006) rather than ignored.

scriptc proves each contract or rejects the program with a diagnostic (SC7001-SC7009) that explains why it does not hold, on every backend: native and WasmGC builds check the same contracts. A program that compiles behaves exactly as under Node.js. See https://scriptc.dev/docs/contracts.
