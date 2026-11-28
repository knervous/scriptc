// The fixed-width integer contracts count only as the annotation of a
// parameter, variable, class instance field or function result. Arrays of
// them (other than Int32[]), unions and interface members are reported
// (SC7006) rather than ignored.
import type { Uint8, Uint32 } from "@scriptc/types";

interface Header {
  length: Uint32;
}

const bytes: Uint8[] = [1, 2];
let maybe: Uint8 | undefined = 1;
const header: Header = { length: 3 };
console.log(bytes.length, maybe, header.length);
