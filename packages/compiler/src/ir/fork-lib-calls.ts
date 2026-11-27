/** libCalls whose operands upstream extended after this fork's frontend was written. The fork's frontend (and its
 * WasmGC backend) keep the shorter operand lists below; the validator checks those as they are, and the LLVM backend
 * pads them to upstream's operands (padForkLibCall) with the values upstream's frontend passes for the same source
 * forms, so upstream's runtime entry points see the calls they expect. */
import { boolLit, dynUndefinedExpr, numLit, strLit } from "./build.js";
import { arrayOf, BOOL, DYN, F64, type IrExpr, type IrType, STRING, VOID } from "./ir.js";

type LibCallExpr = IrExpr & { kind: "libCall" };

/** The fork's operand types (null: any type) of each adapted libCall. */
export const FORK_LIB_CALL_ARGS: ReadonlyMap<string, readonly (IrType | null)[]> = new Map<string, (IrType | null)[]>([
  ["assert.ok", [BOOL, STRING]],
  ["assert.shapeEnd", [STRING, BOOL]],
  ["assert.throwsMismatch", [STRING, null, STRING, BOOL]],
  ["assert.throwsRegex", [null, null, STRING, BOOL]],
  ["cp.execCapture", [STRING, arrayOf(STRING), STRING, BOOL, arrayOf(STRING), F64]],
  ["cp.execFile", [STRING, arrayOf(STRING), null]],
  ["dgram.sendChk", [null, null, null, null, null, null, STRING]],
  ["cp.execSync", [STRING, arrayOf(STRING), BOOL, STRING, BOOL, STRING, BOOL, arrayOf(STRING), F64, F64, F64]],
  ["http.agentNew", [BOOL, BOOL, F64, F64, F64, F64, F64]],
  ["readable.fromArr", [null, BOOL]],
  ["test.hook", [F64, null, F64]],
  ["test.register", [STRING, F64, STRING, null, F64, STRING]],
  ["test.registerEmpty", [STRING, F64, STRING, F64, STRING]],
  ["test.sub", [null, STRING, F64, STRING, null, F64, STRING]],
  ["test.subEmpty", [null, STRING, F64, STRING, STRING]],
  ["test.suite", [STRING, F64, STRING, null, STRING]],
  ["bytes.instanceOf", [null, null]],
  ["assert.expectsErrDyn", [null, null, STRING, BOOL]],
  ["insp.layout", [F64, F64, BOOL]],
  ["fs.openSync", [STRING, STRING]],
  ["fs.callbackValue", [STRING]],
  // 2026-11 (upstream 573b8150e7..2e979d673b).
  ["cp.spawnSync", [STRING, arrayOf(STRING)]],
  ["cp.spawnSyncOpts", [STRING, arrayOf(STRING), F64, STRING, F64, F64, F64]],
  ["cp.spawnSyncStdioStr", [STRING, arrayOf(STRING), F64, STRING, STRING]],
  ["dc.channel", [STRING]],
  ["dc.hasSubscribers", [STRING]],
  ["dc.tracingChannel", [STRING]],
  ["dc.subscribe", [STRING, null]],
  ["dc.unsubscribe", [STRING, null]],
  ["dgram.createSocket", [BOOL]],
  ["fs.watch", [STRING]],
  ["fs.watchCb", [STRING, null]],
  ["http2.sessionRequest", [null, null, F64]],
  ["net.connectLookup", [F64, STRING, null]],
  ["net.setAutoSelTimeout", [F64]],
  ["net.sockSetNoDelay", [null, BOOL]],
  ["readable.opEvery", [null, null, null]],
  ["readable.opFilter", [null, null, null]],
  ["readable.opFind", [null, null, null]],
  ["readable.opFlatMap", [null, null, null]],
  ["readable.opForEach", [null, null, null]],
  ["readable.opMap", [null, null, null]],
  ["readable.opSome", [null, null, null]],
]);

/** libCalls whose results upstream widened: the fork's frontend builds them as statements with these results. */
export const FORK_LIB_CALL_RESULTS: ReadonlyMap<string, IrType> = new Map<string, IrType>([
  ["net.sockWrite", VOID],
  ["net.sockWriteBytes", VOID],
  ["net.sockWriteDyn", VOID],
  ["http.clientWrite", VOID],
  ["http.clientWriteBytes", VOID],
  ["http.clientWriteDyn", VOID],
  ["http.resWrite", VOID],
  ["http.resWriteBytes", VOID],
  ["http.resWriteDyn", VOID],
  ["readable.unshift", VOID],
  ["readable.unshiftDyn", VOID],
  ["readable.unshiftStr", VOID],
  ["fs.watchFile", VOID],
]);

/** libCalls whose results upstream changed to a checked-dynamic value: the fork's frontend types them as below, and
 * the LLVM emitter converts upstream's dyn result through the checked conversion to that type. */
export const FORK_LIB_CALL_DYN_RESULTS: ReadonlySet<string> = new Set(["dc.chanName", "emitter.names"]);

/** Upstream's result type for a call the fork's frontend built with its narrower result, or null. */
export function widenedForkLibCallResult(e: LibCallExpr, upstream: IrType): IrType | null {
  const fork = FORK_LIB_CALL_RESULTS.get(e.fn);
  return fork !== undefined && e.type.kind === fork.kind && upstream.kind !== fork.kind ? upstream : null;
}

/** The `length` Node's filesystem callback functions carry (`fs.readFile.length` is 3), as upstream's frontend
 * passes it to fs.callbackValue (frontend/lowering/surfaces.ts). */
const FS_CALLBACK_VALUE_LENGTHS: Readonly<Record<string, number | undefined>> = {
  access: 3,
  cp: 4,
  copyFile: 4,
  chmod: 3,
  chown: 4,
  lchown: 4,
  fchown: 4,
  glob: 3,
  link: 3,
  mkdir: 3,
  mkdtemp: 3,
  rm: 3,
  rmdir: 3,
  unlink: 2,
  open: 4,
  close: 1,
  fstat: 1,
  ftruncate: 1,
  fsync: 2,
  fdatasync: 2,
  fchmod: 3,
  read: 6,
  write: 6,
  readv: 4,
  writev: 4,
  readlink: 3,
  realpath: 3,
  rename: 3,
  stat: 1,
  lstat: 1,
  symlink: 4,
  statfs: 1,
  truncate: 3,
  utimes: 4,
  futimes: 4,
  lutimes: 4,
  readFile: 3,
  writeFile: 4,
  appendFile: 4,
  readdir: 3,
};

/** Node's generated assert.ok messages (the fork's frontend passes them as literals). */
function generatedOkMessage(message: IrExpr): boolean {
  return (
    message.kind === "strLit" &&
    (message.value.startsWith("The expression evaluated to a falsy value") ||
      message.value === "No value argument passed to `assert.ok()`")
  );
}

/** A literal's number, or null. */
function literalNumber(e: IrExpr): number | null {
  return e.kind === "numLit" ? e.value : null;
}

/** Upstream's operands for a call the fork's frontend built with its shorter list, or null when `e` needs none. */
export function padForkLibCall(e: LibCallExpr): IrExpr[] | null {
  const fork = FORK_LIB_CALL_ARGS.get(e.fn);
  if (fork === undefined || e.args.length !== fork.length) return null;
  const a = e.args, loc = e.loc;
  // test.register/sub and their empty forms: no { plan } (-1), timeout or concurrency (0).
  const planTimeoutConcurrency = (): IrExpr[] => [numLit(-1, loc), numLit(0, loc), numLit(0, loc)];
  switch (e.fn) {
    case "assert.ok":
      // The fourth operand (upstream dbb265b842): derive generatedMessage from a message value's truthiness, as the
      // runtime always did before; upstream's frontend turns it off for assert.ok, which this fork's lowering predates.
      return [a[0]!, a[1]!, boolLit(generatedOkMessage(a[1]!), loc), boolLit(true, loc)];
    case "assert.shapeEnd":
    case "assert.throwsMismatch":
    case "assert.throwsRegex":
    case "assert.expectsErrDyn":
      // Not a rejection (assert.rejects is the async twin).
      return [...a, boolLit(false, loc)];
    case "cp.execCapture":
      // The fork's capture runs a file (execFile): no shell.
      return [a[0]!, a[1]!, boolLit(false, loc), ...a.slice(2)];
    case "cp.execFile":
      return [...a, boolLit(false, loc)];
    case "cp.execSync":
      // Outputs are strings: the fork lowers only the encoding forms (utf8).
      return [...a, strLit("utf8", loc)];
    case "cp.spawnSync":
    case "cp.spawnSyncOpts":
    case "cp.spawnSyncStdioStr":
      // No encoding option: "" (the unencoded form, whose string reads answer the captured bytes).
      return [...a, strLit("", loc)];
    case "dc.channel":
    case "dc.hasSubscribers":
    case "dc.tracingChannel":
    case "dc.subscribe":
    case "dc.unsubscribe":
      // Upstream takes the channel name as a checked-dynamic value (symbols too); the fork's is a string.
      if (a[0]!.type.kind !== "string") return null;
      return [{ kind: "dynFrom", value: a[0]!, type: DYN, loc }, ...a.slice(1)];
    case "dgram.createSocket":
      // createSocket's options object: { type: "udp4", reuseAddr } (the fork lowers udp4 only).
      if (a[0]!.type.kind !== "bool") return null;
      return [
        {
          kind: "dynObjLit",
          fields: [
            { key: strLit("type", loc), value: { kind: "dynFrom", value: strLit("udp4", loc), type: DYN, loc } },
            { key: strLit("reuseAddr", loc), value: { kind: "dynFrom", value: a[0]!, type: DYN, loc } },
          ],
          type: DYN,
          loc,
        },
      ];
    case "fs.watch":
    case "fs.watchCb":
      // persistent: true and recursive: false (Node's defaults; the fork lowers neither option).
      return [...a, boolLit(true, loc), boolLit(false, loc)];
    case "http2.sessionRequest":
      // No waitForTrailers.
      return [...a, boolLit(false, loc)];
    case "net.connectLookup":
      // No per-attempt budget.
      return [...a, dynUndefinedExpr(loc)];
    case "net.setAutoSelTimeout":
    case "net.sockSetNoDelay": {
      // Upstream validates the argument as a checked-dynamic value.
      const i = a.length - 1;
      if (a[i]!.type.kind === "dyn") return null;
      return [...a.slice(0, i), { kind: "dynFrom", value: a[i]!, type: DYN, loc }];
    }
    case "dgram.sendChk":
      // The fork passes four arguments and its fence text; upstream's ladder takes five (the fifth undefined here)
      // and sends every validated form itself.
      return [...a.slice(0, 6), dynUndefinedExpr(loc)];
    case "http.agentNew":
      // (https, keepAlive, keepAliveMsecs, maxSockets, maxFree, timeout, port) -> upstream's (..., maxFree,
      // maxTotalSockets set, maxTotalSockets, timeout, port, scheduling): no maxTotalSockets (Infinity), no
      // `scheduling` option ('lifo').
      return [...a.slice(0, 5), boolLit(false, loc), numLit(Infinity, loc), ...a.slice(5), dynUndefinedExpr(loc)];
    case "readable.fromArr": {
      // (source, strings) -> (source, flags, highWaterMark): flag 1 for string chunks, no highWaterMark (flag 8 off).
      const strings = a[1]!;
      const flags: IrExpr =
        strings.kind === "boolLit"
          ? numLit(strings.value ? 1 : 0, loc)
          : { kind: "ternary", cond: strings, then: numLit(1, loc), else_: numLit(0, loc), type: F64, loc };
      return [a[0]!, flags, numLit(0, loc)];
    }
    case "fs.callbackValue": {
      const member = a[0]!.kind === "strLit" ? a[0]!.value : "";
      return [a[0]!, numLit(FS_CALLBACK_VALUE_LENGTHS[member] ?? 0, loc)];
    }
    case "fs.openSync":
      // No creation mode: Node's 0o666.
      return [...a, numLit(0o666, loc)];
    case "insp.layout":
      // No maxArrayLength option: Node's default 100 (the call site restores it after the render).
      return [...a, numLit(100, loc)];
    case "bytes.instanceOf":
      // No refusal text: the runtime's own message for a native constructor without an instance test.
      return [...a, strLit("instanceof against this native constructor is not supported yet", loc)];
    case "readable.opEvery":
    case "readable.opFilter":
    case "readable.opFind":
    case "readable.opFlatMap":
    case "readable.opForEach":
    case "readable.opMap":
    case "readable.opSome":
      // The fork's callbacks take no { signal }.
      return [...a, dynUndefinedExpr(loc)];
    case "test.hook":
      // The hook call's "file:line:col".
      return [...a, strLit("", loc)];
    case "test.register":
    case "test.registerEmpty":
    case "test.sub":
      // Then no signal and no tags.
      return [...a, ...planTimeoutConcurrency(), dynUndefinedExpr(loc), dynUndefinedExpr(loc)];
    case "test.subEmpty":
      // (ctx, name, mode, msg, at) -> (ctx, name, mode, msg, flags, at, plan, timeout, concurrency, signal, tags).
      return [a[0]!, a[1]!, a[2]!, a[3]!, numLit(0, loc), a[4]!, ...planTimeoutConcurrency(), dynUndefinedExpr(loc), dynUndefinedExpr(loc)];
    case "test.suite": {
      // Flags: describe.only (mode 3) marks the suite (4); a body that takes the SuiteContext sets 2. No concurrency.
      const cb = a[3]!;
      const flags = (literalNumber(a[1]!) === 3 ? 4 : 0) | (cb.type.kind === "func" && cb.type.params.length === 1 ? 2 : 0);
      // (name, mode, msg, cb, at) -> (..., at, flags, concurrency, timeout, signal, tags).
      return [...a, numLit(flags, loc), numLit(0, loc), numLit(0, loc), dynUndefinedExpr(loc), dynUndefinedExpr(loc)];
    }
    default:
      return null;
  }
}
