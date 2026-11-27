/* The native-dyn browser forms on the LLVM lane: IR the WasmGC browser frontend's native dyn model produces
 * (SCRIPTC_EXPERIMENT_LLVM_NATIVE_ANY, the native host island), lowered onto LLVM's own dyn model. WasmGC reads
 * these against its dyn structs ($typedrec, dyn:arr, $classbase); here typed class instances cross into dyn as
 * TYPED_REF capsules, records as ordinary dyn object copies, and host values as JSVAL nodes. The runtime half is
 * scr_dyn_native.c (and scr_dyn_native_symbol.c). */
import type { LibCallExpr, LlValue, LlvmEmitterContext } from "./expr-context.js";
import { InternalCompilerError } from "../../errors.js";
import { STRING } from "../../ir/ir.js";
import { DYN_KIND } from "./dyn.js";
import { emitDateTimeArg } from "./lib-dispatch.js";
import { LlvmUnsupportedError } from "./unsupported.js";

/** The constructor-value libCalls: built once (the runtime keeps each value by id), their operands evaluated only
 * by the build. `id` names the value; the builder takes the first `arity` operands, borrowed. */
const CTOR_VALUES: Record<string, { builder: string; arity: number; id?: string }> = {
  "dyn.arrayConstructorValue": { builder: "scr_dyn_native_array_ctor_value", arity: 3, id: "Array" },
  "dyn.objectConstructorValue": { builder: "scr_dyn_native_object_ctor_value", arity: 2, id: "Object" },
  "dyn.symbolConstructorValue": { builder: "scr_dyn_native_symbol_ctor_value", arity: 3, id: "Symbol" },
  "dyn.constructorStatics": { builder: "scr_dyn_native_ctor_statics", arity: 3 },
};

/** The numeric-key fast tests (scr_dyn_native.c's test numbers). */
const INDEX_TESTS: Record<string, number> = {
  "dyn.isArrayIndex": 0,
  "dyn.isArrayStoreIndex": 1,
  "dyn.isTypedArrayIndex": 2,
  "dyn.isStringIndex": 3,
};

/** The lowering of a native-dyn form, or null when `e` is none (the caller's dispatch continues). */
export function emitNativeDynLibCall(host: LlvmEmitterContext, e: LibCallExpr): LlValue | null {
  switch (e.fn) {
    // A typed record behind an untyped value: WasmGC keeps the record itself ($typedrec). LLVM copies a record into
    // an ordinary dyn object when it crosses (sc_td_* for a record shape), so no dyn value is a typed record; the
    // class property dispatch's fallback reads that copy exactly as the record access would.
    case "dyn.isTypedRecord":
    // A number slot holding JS's undefined (WasmGC's reserved NaN, an out-of-range typed-array read): an LLVM f64
    // never holds it (that read throws a RangeError here instead), so the test is false once the operand has been
    // evaluated (num.typeof's reasoning).
    case "num.isUndefined":
    // A record built from untyped data that kept undeclared or reordered own keys (WasmGC's record extension): LLVM's
    // dyn-to-record conversion keeps only the declared fields, so no record answers 1.
    case "record.hasSrc": {
      host.emitExpr(e.args[0]!);
      return { name: "false", type: e.type };
    }
    // The literal, carrying the spread sources' own keys when a source carries any: none does here (record.hasSrc),
    // so it is the literal. The sources are not evaluated again (WasmGC reads them only for that test).
    case "record.carry": return host.emitExpr(e.args[0]!);
    // Whether a dyn value is a compiled class instance at all: the class chains' early exit (`%dyn.class.properties`).
    // Every arm of those chains tests dyn.typedRefIs, which only a TYPED_REF capsule passes, so testing for a capsule
    // (generators included: they miss every arm and answer the value) keeps each chain's answer.
    case "dyn.isClassInstance": {
      const B = host.B;
      const value = host.emitReadReceiver(e.args[0]!);
      const slot = B.slot();
      B.entryAllocas.push(`${slot} = alloca i1`);
      B.line(`store i1 false, ptr ${slot}`);
      const present = B.tmp();
      const inspect = B.newLabel("class.inspect");
      const done = B.newLabel("class.done");
      B.line(`${present} = icmp ne ptr ${value.name}, null`);
      B.condBr(present, inspect, done);
      B.startBlock(inspect);
      const capsule = B.tmp();
      B.line(`${capsule} = icmp eq i32 ${host.dynKind(value.name)}, ${DYN_KIND.TYPED_REF}`);
      B.line(`store i1 ${capsule}, ptr ${slot}`);
      B.br(done);
      B.startBlock(done);
      const result = B.tmp();
      B.line(`${result} = load i1, ptr ${slot}`);
      return { name: result, type: e.type };
    }
    // `value instanceof G` for a builtin constructor global G (a literal name): by the value's runtime kind.
    case "dyn.instanceOfGlobal": {
      const global = e.args[1];
      if (global?.kind !== "strLit") throw new InternalCompilerError("llvm emitter bug: dyn.instanceOfGlobal of a computed global");
      const value = host.emitExpr(e.args[0]!);
      const S = host.sizeType;
      host.declare(`declare zeroext i1 @scr_dyn_native_instance_of_global(ptr, ptr, ${S})`);
      const result = host.B.tmp();
      host.B.line(`${result} = call zeroext i1 @scr_dyn_native_instance_of_global(ptr ${value.name}, ptr ${host.cstr(global.value)}, ${S} ${Buffer.byteLength(global.value, "utf8")})`);
      return { name: result, type: e.type };
    }
    // Object.freeze of a typed record: the frozen bit in its rc word (frozen-records.ts), the same record back.
    case "record.freeze": {
      const record = host.emitExpr(e.args[0]!);
      host.declare(`declare void @scr_record_freeze(ptr)`);
      host.B.line(`call void @scr_record_freeze(ptr ${record.name})`);
      return record;
    }
    // A width copy of a record keeps its source's integrity level: the copy, frozen when the source is.
    case "record.inherit": {
      const copy = host.emitExpr(e.args[0]!);
      const source = host.emitExpr(e.args[1]!);
      const [copyType, sourceType] = [e.args[0]!.type, e.args[1]!.type];
      if (copyType.kind === "record" && sourceType.kind === "record" && host.freezableShapes.has(sourceType.shapeId)) {
        host.declare(`declare void @scr_record_inherit(ptr, ptr)`);
        host.B.line(`call void @scr_record_inherit(ptr ${copy.name}, ptr ${source.name})`);
      }
      return copy;
    }
    // Object.freeze of a typed record crossing as an untyped value (a tuple: the frontend boxes it): the record's frozen
    // bit through its capsule (its shape is freezable, frozen-records.ts), the capsule back.
    case "dyn.freeze": {
      const operand = e.args[0];
      if (operand?.kind !== "dynFrom" || operand.value.type.kind !== "record") return null;
      const boxed = host.emitExpr(operand);
      host.declare(`declare ptr @scr_dyn_freeze_record(ptr)`);
      const frozen = host.B.tmp();
      host.B.line(`${frozen} = call ptr @scr_dyn_freeze_record(ptr ${boxed.name})`);
      return host.own({ name: frozen, type: e.type });
    }
    // Object.isFrozen of a typed record (the record crossing as an untyped value): its frozen bit. A record whose
    // shape the program never freezes is never frozen; the dyn copy cannot say (a native snapshot).
    case "dyn.isFrozen": {
      const operand = e.args[0];
      if (operand?.kind !== "dynFrom" || operand.value.type.kind !== "record") return null;
      const record = host.emitExpr(operand.value);
      if (!host.freezableShapes.has(operand.value.type.shapeId)) return { name: "false", type: e.type };
      host.declare(`declare zeroext i1 @scr_record_is_frozen(ptr)`);
      const frozen = host.B.tmp();
      host.B.line(`${frozen} = call zeroext i1 @scr_record_is_frozen(ptr ${record.name})`);
      return { name: frozen, type: e.type };
    }
    // A standard-library function taken as a value: one compiled function (the frontend asks only for Object.is).
    case "dyn.builtinFunction": {
      const [owner, member] = e.args;
      if (owner?.kind !== "strLit" || member?.kind !== "strLit" || `${owner.value}.${member.value}` !== "Object.is")
        throw new InternalCompilerError(`llvm emitter bug: dyn.builtinFunction other than Object.is`);
      const S = host.sizeType;
      host.declare(`declare ptr @scr_dyn_native_builtin_function(ptr, ${S})`);
      const value = host.B.tmp();
      host.B.line(`${value} = call ptr @scr_dyn_native_builtin_function(ptr ${host.cstr("Object.is")}, ${S} 9)`);
      return host.own({ name: value, type: e.type });
    }
  }
  const index = INDEX_TESTS[e.fn];
  if (index !== undefined) {
    // A numeric key's fast test on a compiled dyn value (the class index dispatchers): the runtime's.
    const value = host.emitReadReceiver(e.args[0]!);
    const position = host.emitExpr(e.args[1]!);
    host.declare(`declare zeroext i1 @scr_dyn_native_index_test(ptr, double, i32)`);
    const result = host.B.tmp();
    host.B.line(`${result} = call zeroext i1 @scr_dyn_native_index_test(ptr ${value.name}, double ${position.name}, i32 ${index})`);
    return { name: result, type: e.type };
  }
  switch (e.fn) {
    // arr[i] of a compiled dyn array that passed its test (and an array pattern's element at a position): the
    // element, a hole or past the end reading as the key path does.
    case "dyn.arrayIndexGet":
    case "dyn.arrayPatternElement": {
      const array = host.emitExpr(e.args[0]!);
      const position = host.emitExpr(e.args[1]!);
      host.declare(`declare ptr @scr_dyn_native_array_index_get(ptr, double)`);
      const element = host.B.tmp();
      host.B.line(`${element} = call ptr @scr_dyn_native_array_index_get(ptr ${array.name}, double ${position.name})`);
      return host.own({ name: element, type: e.type });
    }
    // arr[i] = v: the ToString(i) key write (growth, holes, frozen and sealed arrays throw as there).
    case "dyn.arrayIndexSet": {
      const [array, position, stored] = e.args.map((arg) => host.emitExpr(arg));
      host.declare(`declare void @scr_dyn_native_array_index_set(ptr, double, ptr)`);
      host.B.line(`call void @scr_dyn_native_array_index_set(ptr ${array!.name}, double ${position!.name}, ptr ${stored!.name})`);
      host.emitPendingCheck();
      return { name: "", type: e.type };
    }
    // A typed array's or a string's element: the ToString(i) key read and write themselves (the tests only pick the
    // dispatcher's fast lane).
    case "dyn.typedArrayIndexGet":
    case "dyn.stringIndexGet":
      return host.emitExpr({ kind: "dynKeyGet", value: e.args[0]!, key: { kind: "toString", operand: e.args[1]!, type: STRING, loc: e.loc }, type: e.type, loc: e.loc });
    case "dyn.typedArrayIndexSet":
      return host.emitExpr({ kind: "libCall", fn: "dyn.keySet", args: [e.args[0]!, { kind: "toString", operand: e.args[1]!, type: STRING, loc: e.loc }, e.args[2]!], type: e.type, loc: e.loc });
    // new Map(iterable) / new Set(iterable) on an untyped source: a compiled native collection (scr_dyn_native.c).
    case "dyn.newCollection": {
      const kind = e.args[0];
      if (kind?.kind !== "strLit" || (kind.value !== "Map" && kind.value !== "Set"))
        throw new InternalCompilerError("llvm emitter bug: dyn.newCollection of an unknown collection");
      const seed = host.emitExpr(e.args[1]!);
      host.declare(`declare ptr @scr_dyn_native_collection_new(ptr, ptr)`);
      const collection = host.B.tmp();
      host.B.line(`${collection} = call ptr @scr_dyn_native_collection_new(ptr ${host.cstr(kind.value)}, ptr ${seed.name})`);
      const out = host.own({ name: collection, type: e.type });
      host.emitPendingCheck();
      return out;
    }
    // Whether a native consumer must open an untyped source through the class dispatch first: a class instance.
    case "dyn.needsOpen": {
      const value = host.emitReadReceiver(e.args[0]!);
      host.declare(`declare zeroext i1 @scr_dyn_native_needs_open(ptr)`);
      const result = host.B.tmp();
      host.B.line(`${result} = call zeroext i1 @scr_dyn_native_needs_open(ptr ${value.name})`);
      return { name: result, type: e.type };
    }
    // The page's array iterator advanced to where a native for-of pass stopped, for IteratorClose after the body made
    // the protocol non-pristine: never reached here (a dyn array stays pristine on this lane, dyn.isPristineArrayIterable),
    // so the operands are evaluated and the path traps.
    case "dyn.arrayIteratorAt": {
      host.emitExpr(e.args[0]!);
      host.emitExpr(e.args[1]!);
      host.declare(`declare void @scr_trap(ptr)`);
      host.B.line(`call void @scr_trap(ptr ${host.cstr("scriptc: dyn.arrayIteratorAt reached on the LLVM lane\n")})`);
      return host.own({ name: "null", type: e.type });
    }
    // A class instance's opened iterator standing as an iterable: refused loudly (scr_dyn_native_opened says why).
    case "dyn.opened": {
      const iterator = host.emitExpr(e.args[0]!);
      host.declare(`declare ptr @scr_dyn_native_opened(ptr)`);
      const result = host.B.tmp();
      host.B.line(`${result} = call ptr @scr_dyn_native_opened(ptr ${iterator.name})`);
      const out = host.own({ name: result, type: e.type });
      host.emitPendingCheck();
      return out;
    }
    // Destructuring a compiled dyn array reads its elements by index: LLVM's iteration of a dyn array is that same
    // element walk (it consults no page iterator protocol), so every dyn array is pristine.
    case "dyn.isPristineArrayIterable": {
      const B = host.B;
      const value = host.emitReadReceiver(e.args[0]!);
      const slot = B.slot();
      B.entryAllocas.push(`${slot} = alloca i1`);
      B.line(`store i1 false, ptr ${slot}`);
      const present = B.tmp();
      const inspect = B.newLabel("pristine.inspect");
      const done = B.newLabel("pristine.done");
      B.line(`${present} = icmp ne ptr ${value.name}, null`);
      B.condBr(present, inspect, done);
      B.startBlock(inspect);
      const array = B.tmp();
      B.line(`${array} = icmp eq i32 ${host.dynKind(value.name)}, ${DYN_KIND.ARR}`);
      B.line(`store i1 ${array}, ptr ${slot}`);
      B.br(done);
      B.startBlock(done);
      const result = B.tmp();
      B.line(`${result} = load i1, ptr ${slot}`);
      return { name: result, type: e.type };
    }
  }
  if (e.fn === "date.hostNum" || e.fn === "date.hostStr") return emitDateHost(host, e);
  const ctor = CTOR_VALUES[e.fn];
  if (ctor) return emitCtorValue(host, e, ctor);
  return null;
}

/** A builtin constructor value (Array, Object, Symbol, or a constructor carrying statics): the runtime's cached
 * value, or the build from the operands on the first read. */
function emitCtorValue(host: LlvmEmitterContext, e: LibCallExpr, ctor: { builder: string; arity: number; id?: string }): LlValue {
  const B = host.B;
  const S = host.sizeType;
  const idArg = e.args[3];
  const id = ctor.id ?? (idArg?.kind === "strLit" ? idArg.value : null);
  if (id === null) throw new InternalCompilerError(`llvm emitter bug: ${e.fn} without a literal id`);
  const idPtr = host.cstr(id);
  const idLen = Buffer.byteLength(id, "utf8");
  host.declare(`declare ptr @scr_dyn_native_ctor_cached(ptr, ${S})`);
  const params = Array.from({ length: ctor.arity }, () => "ptr");
  if (!ctor.id) params.push("ptr", S);
  host.declare(`declare ptr @${ctor.builder}(${params.join(", ")})`);
  const slot = B.slot();
  B.entryAllocas.push(`${slot} = alloca ptr`);
  const cached = B.tmp();
  B.line(`${cached} = call ptr @scr_dyn_native_ctor_cached(ptr ${idPtr}, ${S} ${idLen})`);
  B.line(`store ptr ${cached}, ptr ${slot}`);
  const missing = B.tmp();
  B.line(`${missing} = icmp eq ptr ${cached}, null`);
  const build = B.newLabel("ctor.build");
  const join = B.newLabel("ctor.join");
  B.condBr(missing, build, join);
  B.startBlock(build);
  // The operands live in the build's own frame: they die on the path that made them.
  host.frames.push([]);
  const operands = e.args.slice(0, ctor.arity).map((arg) => `ptr ${host.emitExpr(arg).name}`);
  if (!ctor.id) operands.push(`ptr ${idPtr}`, `${S} ${idLen}`);
  const built = B.tmp();
  B.line(`${built} = call ptr @${ctor.builder}(${operands.join(", ")})`);
  B.line(`store ptr ${built}, ptr ${slot}`);
  host.releaseTemps(host.frames.pop()!);
  B.br(join);
  B.startBlock(join);
  const value = B.tmp();
  B.line(`${value} = load ptr, ptr ${slot}`);
  return host.own({ name: value, type: e.type });
}

/** The calendar getters' runtime stems (scr_date_get_<stem>_local / _utc). */
const DATE_GETTERS: Record<string, string> = {
  FullYear: "full_year", Month: "month", Date: "date", Day: "day", Hours: "hours", Minutes: "minutes", Seconds: "seconds",
};

/** The browser frontend's host-backed Date members (date.hostNum / date.hostStr: the page's own Date there). The
 * members are the runtime's own date functions over the Date's time value (an f64; a Date object's ScrDate.ms): the getters,
 * getTime / valueOf, getTimezoneOffset, Date.UTC, toISOString, toJSON and toString / toDateString / toTimeString. The setters (a time value has no identity
 * to mutate) and the locale and display formatters (no runtime formatter) have no lowering. */
function emitDateHost(host: LlvmEmitterContext, e: LibCallExpr): LlValue {
  const B = host.B;
  const methodArg = e.args[0];
  if (methodArg?.kind !== "strLit") throw new InternalCompilerError(`llvm emitter bug: ${e.fn} without a literal member`);
  const method = methodArg.value;
  const call = (sym: string, operands: string[], ret: "double" | "ptr"): string => {
    host.declare(`declare ${ret} @${sym}(${operands.map(() => "double").join(", ")})`);
    const t = B.tmp();
    B.line(`${t} = call ${ret} @${sym}(${operands.map((o) => `double ${o}`).join(", ")})`);
    return t;
  };
  if (method === "UTC") {
    // Date.UTC at the call's own arity: the spec's defaults complete the seven parts (month 0, date 1, time 0).
    const parts = e.args.slice(1).map((arg) => host.emitExpr(arg).name);
    const defaults = ["0.0", "0.0", "1.0", "0.0", "0.0", "0.0", "0.0"];
    return { name: call("scr_date_utc", defaults.map((d, i) => parts[i] ?? d), "double"), type: e.type };
  }
  const getter = /^get(UTC)?(FullYear|Month|Date|Day|Hours|Minutes|Seconds|Milliseconds)$/.exec(method);
  const formats: Record<string, string> = { toString: "0.0", toDateString: "1.0", toTimeString: "2.0" };
  const known = getter !== null || method in formats || ["getTime", "valueOf", "getTimezoneOffset", "toISOString", "toJSON"].includes(method);
  if (!known) throw new LlvmUnsupportedError(`${e.fn}:${method}`, e.loc);
  // The receiver: a time value, or (upstream's backend, where a Date is an object) a Date, whose time value the
  // runtime functions take.
  const receiver = e.args[1]!;
  const time = receiver.type.kind === "date" ? emitDateTimeArg(host, receiver) : host.emitExpr(receiver).name;
  if (getter) {
    const field = getter[2]!;
    const sym = field === "Milliseconds" ? "scr_date_get_milliseconds" : `scr_date_get_${DATE_GETTERS[field]}_${getter[1] ? "utc" : "local"}`;
    return { name: call(sym, [time], "double"), type: e.type };
  }
  // The display forms in V8's shape (the runtime's scr_date_to_string_form; the zone named by its abbreviation).
  if (Object.hasOwn(formats, method)) return host.own({ name: call("scr_date_to_string_form", [time, formats[method]!], "ptr"), type: e.type });
  if (method === "getTime" || method === "valueOf") return { name: call("scr_date_get_time", [time], "double"), type: e.type };
  if (method === "getTimezoneOffset") return { name: call("scr_date_get_timezone_offset", [time], "double"), type: e.type };
  if (method === "toJSON") {
    // toJSON answers null for an invalid time value, which a string cannot hold: loud, as on WasmGC.
    const invalid = B.tmp(), refuse = B.newLabel("tojson.invalid"), format = B.newLabel("tojson.format");
    B.line(`${invalid} = fcmp uno double ${time}, ${time}`);
    B.condBr(invalid, refuse, format);
    B.startBlock(refuse);
    const message = "Date.prototype.toJSON of an invalid Date is null, which a string cannot hold";
    host.declare(`declare void @scr_throw_error_msg(i32, ptr, ${host.sizeType})`);
    B.line(`call void @scr_throw_error_msg(i32 1, ptr ${host.cstr(message)}, ${host.sizeType} ${Buffer.byteLength(message, "utf8")})`);
    host.emitPendingCheck();
    B.br(format);
    B.startBlock(format);
  }
  // toISOString (and a valid toJSON): Node's ISO format; an invalid time value throws its RangeError.
  const text = host.own({ name: call("scr_date_to_iso", [time], "ptr"), type: e.type });
  host.emitPendingCheck();
  return text;
}
