/* Frozen records on the LLVM lane (record.freeze / record.inherit, which the browser frontend's native dyn model
 * emits for Object.freeze of a typed record and the width copies of one). Upstream scriptc's design on this runtime:
 * a record a program may freeze keeps a frozen bit in its rc word (scr_dyn_native.c SCR_RECORD_FROZEN, bit 62 on
 * 64-bit targets, 30 on 32-bit ones), its emitted release counts without the bit (shapes.ts), and every write to it
 * tests the bit first: a strict-mode write throws Node's TypeError, a sloppy-mode one leaves the record unchanged.
 * Records keep their layout. Only the shapes a program may freeze pay for any of it. */
import type { IrModule, SrcLoc } from "../../ir/ir.js";
import { everyStmtList } from "../../ir/traverse.js";
import type { LlvmEmitterContext } from "./expr-context.js";

/** The record shapes whose values may be frozen: every record.freeze target, and the width copies (record.inherit)
 * of one, to a fixed point. */
export function freezableRecordShapes(mod: IrModule): Set<string> {
  const shapes = new Set<string>();
  const copies: { copy: string; source: string }[] = [];
  for (const fn of mod.functions)
    everyStmtList(fn.body, {
      expr: (e) => {
        if (e.kind !== "libCall") return true;
        const [first, second] = e.args;
        if (e.fn === "record.freeze" && first?.type.kind === "record") shapes.add(first.type.shapeId);
        // A record boxed for Object.freeze (a tuple, which the frontend keeps off record.freeze): its bit, through the
        // capsule (lib-native-dyn.ts dyn.freeze).
        if (e.fn === "dyn.freeze" && first?.kind === "dynFrom" && first.value.type.kind === "record") shapes.add(first.value.type.shapeId);
        if (e.fn === "record.inherit" && first?.type.kind === "record" && second?.type.kind === "record")
          copies.push({ copy: first.type.shapeId, source: second.type.shapeId });
        return true;
      },
      stmt: () => true,
    });
  for (let changed = true; changed;) {
    changed = false;
    for (const { copy, source } of copies) {
      if (!shapes.has(source) || shapes.has(copy)) continue;
      shapes.add(copy);
      changed = true;
    }
  }
  return shapes;
}

/** The frozen bit of a freezable record's rc word, as a signed literal of the target's size type. */
export function recordFrozenBit(sizeType: "i32" | "i64"): string {
  return BigInt.asIntN(sizeType === "i64" ? 64 : 32, 1n << (sizeType === "i64" ? 62n : 30n)).toString();
}

/** The count of a freezable record's rc word: the word without its frozen bit. */
export function recordNotFrozen(sizeType: "i32" | "i64"): string {
  return BigInt.asIntN(sizeType === "i64" ? 64 : 32, ~(1n << (sizeType === "i64" ? 62n : 30n))).toString();
}

/** A write to a record of a freezable shape: branches on the record's frozen bit before the write the caller emits
 * next. A frozen record's strict-mode write throws (`operation`: 0 assigns, 1 adds a key, 2 deletes one, or an i1
 * choosing between assign and add); a sloppy-mode one skips the write, after `skip` (the write's moved operands).
 * Returns the label the caller branches to after its write, or null when the shape is never frozen (no guard). */
export function emitFrozenRecordGuard(
  host: LlvmEmitterContext,
  record: string,
  shapeId: string,
  key: string,
  operation: 0 | 1 | 2 | { assignWhen: string },
  loc: SrcLoc,
  skip: () => void,
): string | null {
  if (!host.freezableShapes.has(shapeId)) return null;
  const B = host.B;
  const S = host.sizeType;
  const rc = B.tmp(), bit = B.tmp(), set = B.tmp(), immortal = B.tmp(), mortal = B.tmp(), frozen = B.tmp();
  B.line(`${rc} = load ${S}, ptr ${record}`);
  B.line(`${bit} = and ${S} ${rc}, ${recordFrozenBit(S)}`);
  B.line(`${set} = icmp ne ${S} ${bit}, 0`);
  B.line(`${immortal} = icmp eq ${S} ${rc}, -1`);
  B.line(`${mortal} = xor i1 ${immortal}, true`);
  B.line(`${frozen} = and i1 ${set}, ${mortal}`);
  const refuse = B.newLabel("frozen.refuse");
  const write = B.newLabel("frozen.write");
  const done = B.newLabel("frozen.done");
  B.condBr(frozen, refuse, write);
  B.startBlock(refuse);
  if (host.sloppyFiles.has(loc.file)) {
    skip();
  } else {
    let op: string;
    if (typeof operation === "number") op = `${operation}.0`;
    else {
      op = B.tmp();
      B.line(`${op} = select i1 ${operation.assignWhen}, double 0.0, double 1.0`);
    }
    // Upstream's scr_record_throw_frozen names the owner: records are plain objects ("#<Object>").
    host.declare(`declare void @scr_record_throw_frozen(ptr, ptr, double)`);
    B.line(`call void @scr_record_throw_frozen(ptr ${key}, ptr ${host.internLiteral("#<Object>")}, double ${op})`);
    host.emitPendingCheck();
  }
  B.br(done);
  B.startBlock(write);
  return done;
}

/** Whether the program may freeze a compiled array: Object.freeze reaches one only through dyn.freeze (its runtime
 * kind), so a module with none leaves its array writes unchecked. With one, every array write is followed by a pending
 * check (a frozen array's write throws; scr_array.c). */
export function arraysMayFreeze(mod: IrModule): boolean {
  let found = false;
  for (const fn of mod.functions) {
    if (found) break;
    everyStmtList(fn.body, {
      expr: (e) => {
        if (e.kind === "libCall" && e.fn === "dyn.freeze") found = true;
        return !found;
      },
      stmt: () => !found,
    });
  }
  return found;
}
