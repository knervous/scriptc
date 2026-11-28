// This file was modified from scriptc (Apache-2.0); see MODIFICATIONS.md.
import {
  BOOL,
  F64,
  type IrExpr,
  type IrFunction,
  type IrLocal,
  type IrParam,
  type IrStmt,
  type IrType,
  JSVAL,
  type SrcLoc,
  arrayOf,
  funcOf,
} from "../../ir/ir.js";
import { numLit, varRef } from "../../ir/build.js";

function readArrayLength(arrT: IrType, loc: SrcLoc): IrStmt {
  return {
    kind: "varDecl",
    localId: "n.0",
    init: {
      kind: "arrIntrinsic",
      method: "length",
      receiver: { kind: "varRef", localId: "a.0", type: arrT, loc },
      args: [],
      type: F64,
      loc,
    },
    loc,
  };
}

/** A stable natural merge sort built from existing IR nodes.
 *
 * The receiver's present values are collected into a private buffer `src`
 * (holes dropped, undefined counted), so every comparator call sees the
 * values captured before sorting starts and a throwing comparator leaves the
 * receiver untouched. The buffer is then sorted in three steps:
 *
 * 1. Run scan, TimSort style. From each run start the next maximal run is
 *    taken: a non-descending run as is, or a STRICTLY descending run
 *    (`cmp(prev, next) > 0` throughout) reversed in place. Strictness keeps
 *    the reversal stable: no two elements of a reversed run compare equal.
 * 2. A run shorter than `minRun` is extended with insertion sort up to
 *    `minRun` elements (or the end): each new element moves left past every
 *    element that compares greater, so equal elements keep their order.
 *    `minRun` is the length's top four bits, plus one if any lower bit is set
 *    (8..16 for 16 or more values, the whole array below 16). TimSort uses
 *    32..64 with binary insertion; measured here, every shift is an element
 *    write and the smaller runs with linear insertion were fastest.
 * 3. Adjacent runs merge pairwise, pass after pass, ping-ponging between
 *    `src` and a second buffer that is only allocated when there are at least
 *    two runs. A merge whose boundary is already ordered is a plain copy.
 *    Otherwise TimSort's pre-merge trim runs first (two binary searches: the
 *    left prefix not greater than the right run's head and the right suffix
 *    not less than the left run's tail are only copied). When one remaining
 *    side is at most 1/32 of the other, each of its elements is placed by
 *    binary search (a cheap stand-in for galloping, never more comparisons
 *    than a lockstep merge below 2^32 elements); otherwise the two sides
 *    merge in lockstep. In every form the right element goes first only when
 *    `cmp(left, right) > 0`, so NaN or 0 keeps the left (earlier) element.
 *
 * Presorted input therefore costs n-1 comparator calls, one collect copy and
 * one write-back, with no merge buffer; descending input costs the same plus
 * an in-place reversal. Arbitrary inputs are O(n log n) comparisons and
 * O(n log(n / minRun)) movement; a few displaced elements in sorted input
 * cost far fewer comparisons than a full merge. Run ends live in an f64
 * array read back with `| 0`, so every index local stays an integer local in
 * the backend (no f64-to-index checks on the hot loops). The final copy
 * preserves Array.sort receiver identity (the comparator can observe the receiver, so the write-back stays
 * even when nothing moved). toSorted starts by copying the receiver and
 * therefore leaves that receiver untouched. Undefined values sink without
 * reaching the user comparator. Galloping is not implemented, and argument
 * order inside the comparator calls is (earlier, later) rather than V8's,
 * so exact comparator call order and count parity with V8 is not claimed;
 * results agree for consistent comparators. */
export function buildArraySortFn(
  name: string,
  elem: IrType,
  arity: number,
  copyFirst: boolean,
  undefinedTag: number | null,
  loc: SrcLoc,
): IrFunction {
  const arrT = arrayOf(elem);
  const endsT = arrayOf(F64);
  const fnT = funcOf([elem, elem].slice(0, arity), F64);

  const a = varRef("a.0", arrT, loc);
  const src = varRef("src.0", arrT, loc);
  const dst = varRef("dst.0", arrT, loc);
  const ends = varRef("ends.0", endsT, loc);
  const n = varRef("n.0", F64, loc);
  const valueCount = varRef("valueCount.0", F64, loc);
  const undefinedCount = varRef("undefinedCount.0", F64, loc);
  const runCount = varRef("runCount.0", F64, loc);
  const minRun = varRef("minRun.0", F64, loc);
  const n0 = varRef("n0.0", F64, loc);
  const rbit = varRef("rbit.0", F64, loc);
  const lo = varRef("lo.0", F64, loc);
  const hi = varRef("hi.0", F64, loc);
  const runEnd = varRef("runEnd.0", F64, loc);
  const p = varRef("p.0", F64, loc);
  const q = varRef("q.0", F64, loc);
  const bl = varRef("bl.0", F64, loc);
  const bh = varRef("bh.0", F64, loc);
  const bm = varRef("bm.0", F64, loc);
  const idx = varRef("idx.0", F64, loc);
  const w = varRef("w.0", F64, loc);
  const start = varRef("start.0", F64, loc);
  const mid = varRef("mid.0", F64, loc);
  const right = varRef("right.0", F64, loc);
  const left = varRef("left.0", F64, loc);
  const r = varRef("r.0", F64, loc);
  const k = varRef("k.0", F64, loc);
  const i = varRef("i.0", F64, loc);
  const j = varRef("j.0", F64, loc);
  const state = varRef("state.0", F64, loc);
  const one = (): IrExpr => numLit(1, loc);
  const add = (left: IrExpr, right: IrExpr): IrExpr => ({ kind: "bin", op: "+", left, right, type: F64, loc });
  const sub = (left: IrExpr, right: IrExpr): IrExpr => ({ kind: "bin", op: "-", left, right, type: F64, loc });
  const bit = (op: "&" | "|" | ">>", left: IrExpr, right: IrExpr): IrExpr => ({ kind: "bin", op, left, right, type: F64, loc });
  const lt = (left: IrExpr, right: IrExpr): IrExpr => ({ kind: "bin", op: "<", left, right, type: BOOL, loc });
  const eq = (left: IrExpr, right: IrExpr): IrExpr => ({ kind: "bin", op: "===", left, right, type: BOOL, loc });
  const not = (value: IrExpr): IrExpr => ({ kind: "unary", op: "!", operand: value, type: BOOL, loc });
  const decl = (localId: string, init: IrExpr): IrStmt => ({ kind: "varDecl", localId, init, loc });
  const assign = (localId: string, value: IrExpr): IrStmt => ({ kind: "assign", localId, value, loc });
  const inc = (localId: string, by: IrExpr = one()): IrStmt =>
    assign(localId, add(varRef(localId, F64, loc), by));
  const brk: IrStmt = { kind: "break", loc };
  const iff = (cond: IrExpr, then: IrStmt[], else_: IrStmt[] | null = null): IrStmt => ({ kind: "if", cond, then, else_, loc });
  const loop = (cond: IrExpr, body: IrStmt[]): IrStmt => ({ kind: "while", cond, body, loc });
  const forever = (body: IrStmt[]): IrStmt => loop({ kind: "boolLit", value: true, type: BOOL, loc }, body);
  const at = (index: IrExpr): IrExpr => ({ kind: "arrayGet", arr: src, index, type: elem, loc });
  const setSrc = (index: IrExpr, value: string): IrStmt =>
    ({ kind: "arraySet", arr: src, index, value: varRef(value, elem, loc), loc });
  const setDst = (index: IrExpr, value: string): IrStmt =>
    ({ kind: "arraySet", arr: dst, index, value: varRef(value, elem, loc), loc });
  const endAt = (index: IrExpr): IrExpr => ({ kind: "arrayGet", arr: ends, index, type: F64, loc });
  const ev = (id: string): IrExpr => varRef(id, elem, loc);
  const stateIs = (value: number): IrExpr => eq(state, numLit(value, loc));
  const isUndefined = (value: IrExpr): IrExpr | null => {
    if (elem.kind === "union" && undefinedTag !== null) {
      return {
        kind: "unionIsTag",
        unionId: elem.unionId,
        tag: undefinedTag,
        negated: false,
        value,
        type: BOOL,
        loc,
      };
    }
    if (elem.kind === "jsval") {
      return {
        kind: "jsOp",
        op: "eq",
        args: [
          value,
          { kind: "jsOp", op: "undefLit", args: [], type: JSVAL, loc },
        ],
        type: BOOL,
        loc,
      };
    }
    return null;
  };
  /** `cmp(leftValue, rightValue) > 0`, with undefined sinking. Both operands
   * must be variable references: they are read more than once. */
  const shouldTakeRight = (leftValue: IrExpr, rightValue: IrExpr): IrExpr => {
    const compareGreater: IrExpr = {
      kind: "bin",
      op: ">",
      left: {
        kind: "callValue",
        callee: varRef("f.0", fnT, loc),
        args: [leftValue, rightValue].slice(0, arity),
        type: F64,
        loc,
      },
      right: numLit(0, loc),
      type: BOOL,
      loc,
    };
    const leftUndefined = isUndefined(leftValue);
    const rightUndefined = isUndefined(rightValue);
    return leftUndefined !== null && rightUndefined !== null
      ? {
          kind: "ternary",
          cond: leftUndefined,
          then: not(rightUndefined),
          else_: {
            kind: "ternary",
            cond: rightUndefined,
            then: { kind: "boolLit", value: false, type: BOOL, loc },
            else_: compareGreater,
            type: BOOL,
            loc,
          },
          type: BOOL,
          loc,
        }
      : compareGreater;
  };

  // ---- collect: present values into src, undefined counted, holes dropped.
  // Reads the receiver directly: no user code runs until collection ends.
  const collect: IrStmt = {
    kind: "for",
    init: decl("i.0", numLit(0, loc)),
    cond: lt(i, n),
    update: inc("i.0"),
    body: [
      decl("state.0", { kind: "arrayState", arr: a, index: i, type: F64, loc }),
      iff(
        stateIs(1),
        [
          decl("v.0", { kind: "arrayGet", arr: a, index: i, type: elem, loc }),
          setSrc(valueCount, "v.0"),
          inc("valueCount.0"),
        ],
        [iff(stateIs(2), [inc("undefinedCount.0")])],
      ),
    ],
    loc,
  };

  // ---- minRun: the top four bits of valueCount, +1 if any bit shifted out
  // (8..16 for arrays of 16 or more; the whole array below 16). TimSort's
  // 32..64 measured slower here: every insertion shift is an element write.
  const computeMinRun: IrStmt[] = [
    decl("n0.0", bit("|", valueCount, numLit(0, loc))),
    decl("rbit.0", numLit(0, loc)),
    loop(lt(numLit(15, loc), n0), [
      assign("rbit.0", bit("|", rbit, bit("&", n0, one()))),
      assign("n0.0", bit(">>", n0, one())),
    ]),
    decl("minRun.0", add(n0, rbit)),
  ];

  // ---- one run from lo: [lo, hi) non-descending afterwards.
  const scanDescending: IrStmt[] = [
    inc("hi.0"),
    forever([
      iff(not(lt(hi, valueCount)), [brk]),
      decl("vL.0", at(sub(hi, one()))),
      decl("vR.0", at(hi)),
      iff(not(shouldTakeRight(ev("vL.0"), ev("vR.0"))), [brk]),
      inc("hi.0"),
    ]),
    // Reverse [lo, hi) in place.
    decl("p.0", lo),
    decl("q.0", sub(hi, one())),
    loop(lt(p, q), [
      decl("vL.0", at(p)),
      decl("vR.0", at(q)),
      setSrc(p, "vR.0"),
      setSrc(q, "vL.0"),
      inc("p.0"),
      assign("q.0", sub(q, one())),
    ]),
  ];
  const scanAscending: IrStmt[] = [
    inc("hi.0"),
    forever([
      iff(not(lt(hi, valueCount)), [brk]),
      decl("vL.0", at(sub(hi, one()))),
      decl("vR.0", at(hi)),
      iff(shouldTakeRight(ev("vL.0"), ev("vR.0")), [brk]),
      inc("hi.0"),
    ]),
  ];
  // Insertion of src[hi..runEnd) into the sorted prefix [lo, hi): each
  // element moves left past every element that compares greater than it, so
  // equal elements keep their order. Comparing while shifting beats a binary
  // search plus a separate shift loop at these run lengths.
  const linearInsertion: IrStmt = {
    kind: "for",
    init: decl("p.0", hi),
    cond: lt(p, runEnd),
    update: inc("p.0"),
    body: [
      decl("pivot.0", at(p)),
      decl("q.0", p),
      forever([
        iff(not(lt(lo, q)), [brk]),
        decl("v.0", at(sub(q, one()))),
        iff(not(shouldTakeRight(ev("v.0"), ev("pivot.0"))), [brk]),
        setSrc(q, "v.0"),
        assign("q.0", sub(q, one())),
      ]),
      setSrc(q, "pivot.0"),
    ],
    loc,
  };
  const runScan: IrStmt[] = [
    decl("ends.0", { kind: "arrayLit", elems: [], type: endsT, loc }),
    decl("runCount.0", numLit(0, loc)),
    ...computeMinRun,
    decl("lo.0", numLit(0, loc)),
    loop(lt(lo, valueCount), [
      decl("hi.0", add(lo, one())),
      // The direction probe's pair stays in scope across the scan, which
      // declares vL/vR in its own loops: it takes the merge's bL/bR (not live
      // here). One local declared again in a nested scope shares one native
      // slot: the inner declaration overwrites the outer value without
      // releasing it, and both scope exits release the inner one.
      iff(lt(hi, valueCount), [
        decl("bL.0", at(lo)),
        decl("bR.0", at(hi)),
        iff(shouldTakeRight(ev("bL.0"), ev("bR.0")), scanDescending, scanAscending),
      ]),
      decl("runEnd.0", valueCount),
      iff(lt(add(lo, minRun), valueCount), [assign("runEnd.0", add(lo, minRun))]),
      iff(lt(hi, runEnd), [linearInsertion, assign("hi.0", runEnd)]),
      // push, not a write at runCount: an append by index regrows the array each time.
      { kind: "exprStmt", expr: { kind: "arrIntrinsic", method: "push", receiver: ends, args: [hi], type: F64, loc }, loc },
      inc("runCount.0"),
      assign("lo.0", hi),
    ]),
  ];

  // ---- pairwise merge passes over the run list, src -> dst, then swap.
  const copyRange: IrStmt = loop(lt(k, right), [
    decl("v.0", at(k)),
    setDst(k, "v.0"),
    inc("k.0"),
  ]);
  const mEnd = varRef("mEnd.0", F64, loc);
  const la = varRef("la.0", F64, loc);
  const lb = varRef("lb.0", F64, loc);
  const copyLeft: IrStmt[] = [decl("v.0", at(left)), setDst(k, "v.0"), inc("left.0"), inc("k.0")];
  const copyRight: IrStmt[] = [decl("v.0", at(r)), setDst(k, "v.0"), inc("r.0"), inc("k.0")];
  /** Binary search `bl.0`/`bh.0` down to one index: `goRight(vM)` true moves
   * the low bound past the probe. */
  const search = (goRight: (probe: IrExpr) => IrExpr): IrStmt =>
    loop(lt(bl, bh), [
      decl("bm.0", bit(">>", add(bl, bh), one())),
      decl("vM.0", at(bm)),
      iff(goRight(ev("vM.0")), [assign("bl.0", add(bm, one()))], [assign("bh.0", bm)]),
    ]);
  // Lockstep merge of src[left, mid) and src[r, mEnd).
  const linearMerge: IrStmt[] = [
    loop({ kind: "logical", op: "&&", left: lt(left, mid), right: lt(r, mEnd), type: BOOL, loc }, [
      decl("vL.0", at(left)),
      decl("vR.0", at(r)),
      iff(
        shouldTakeRight(ev("vL.0"), ev("vR.0")),
        [setDst(k, "vR.0"), inc("r.0")],
        [setDst(k, "vL.0"), inc("left.0")],
      ),
      inc("k.0"),
    ]),
    loop(lt(left, mid), copyLeft),
    loop(lt(r, mEnd), copyRight),
  ];
  // The left side is much shorter: each left element finds its place in
  // the right side by binary search (right elements equal to it stay after).
  const leftIntoRight: IrStmt[] = [
    loop(lt(left, mid), [
      decl("pivot.0", at(left)),
      decl("bl.0", r),
      decl("bh.0", mEnd),
      search((probe) => shouldTakeRight(ev("pivot.0"), probe)),
      loop(lt(r, bl), copyRight),
      setDst(k, "pivot.0"),
      inc("k.0"),
      inc("left.0"),
    ]),
    loop(lt(r, mEnd), copyRight),
  ];
  // The right side is much shorter: each right element goes after every
  // left element that does not compare greater.
  const rightIntoLeft: IrStmt[] = [
    loop(lt(r, mEnd), [
      decl("pivot.0", at(r)),
      decl("bl.0", left),
      decl("bh.0", mid),
      search((probe) => not(shouldTakeRight(probe, ev("pivot.0")))),
      loop(lt(left, bl), copyLeft),
      setDst(k, "pivot.0"),
      inc("k.0"),
      inc("r.0"),
    ]),
    loop(lt(left, mid), copyLeft),
  ];
  const skew = numLit(32, loc);
  const mul = (x: IrExpr, y: IrExpr): IrExpr => ({ kind: "bin", op: "*", left: x, right: y, type: F64, loc });
  const le = (x: IrExpr, y: IrExpr): IrExpr => ({ kind: "bin", op: "<=", left: x, right: y, type: BOOL, loc });
  /** Merge src[left, mid) with src[mid, right) into dst[left, right), known
   * unordered at the boundary (src[mid-1] > src[mid]). TimSort's pre-merge
   * trim first: the left prefix not greater than src[mid] and the right
   * suffix not less than src[mid-1] are already in place and only copied. */
  const mergeBody: IrStmt[] = [
    decl("bl.0", left),
    decl("bh.0", sub(mid, one())),
    search((probe) => not(shouldTakeRight(probe, ev("bR.0")))),
    loop(lt(left, bl), copyLeft),
    decl("bl.0", add(mid, one())),
    decl("bh.0", right),
    search((probe) => shouldTakeRight(ev("bL.0"), probe)),
    decl("mEnd.0", bl),
    decl("q.0", bl),
    loop(lt(q, right), [decl("v.0", at(q)), setDst(q, "v.0"), inc("q.0")]),
    decl("la.0", sub(mid, left)),
    decl("lb.0", sub(mEnd, mid)),
    iff(
      le(mul(la, skew), lb),
      leftIntoRight,
      [iff(le(mul(lb, skew), la), rightIntoLeft, linearMerge)],
    ),
  ];
  const mergeOrCopy: IrStmt = iff(
    lt(mid, right),
    [
      decl("bL.0", at(sub(mid, one()))),
      decl("bR.0", at(mid)),
      iff(shouldTakeRight(ev("bL.0"), ev("bR.0")), mergeBody, [copyRange]),
    ],
    [copyRange],
  );
  const mergePass: IrStmt[] = [
    decl("idx.0", numLit(0, loc)),
    decl("w.0", numLit(0, loc)),
    decl("start.0", numLit(0, loc)),
    loop(lt(idx, runCount), [
      decl("mid.0", bit("|", endAt(idx), numLit(0, loc))),
      decl("right.0", {
        kind: "ternary",
        cond: lt(add(idx, one()), runCount),
        then: bit("|", endAt(add(idx, one())), numLit(0, loc)),
        else_: mid,
        type: F64,
        loc,
      }),
      decl("left.0", start),
      decl("r.0", mid),
      decl("k.0", start),
      mergeOrCopy,
      { kind: "arraySet", arr: ends, index: w, value: right, loc },
      inc("w.0"),
      inc("idx.0", numLit(2, loc)),
      assign("start.0", right),
    ]),
    assign("runCount.0", w),
    decl("tmp.0", src),
    assign("src.0", dst),
    assign("dst.0", varRef("tmp.0", arrT, loc)),
  ];
  const merge: IrStmt = iff(lt(one(), runCount), [
    // A full-length copy, never an empty array: the trim writes a merge's tail
    // before its middle, and writing past the end would leave holes behind.
    assign("dst.0", { kind: "arrIntrinsic", method: "slice", receiver: src, args: [], type: arrT, loc }),
    loop(lt(one(), runCount), mergePass),
  ]);

  // ---- write back into the receiver.
  const writeValues: IrStmt = {
    kind: "for",
    init: decl("i.0", numLit(0, loc)),
    cond: lt(i, valueCount),
    update: inc("i.0"),
    body: [
      decl("v.0", at(i)),
      { kind: "arraySet", arr: a, index: i, value: ev("v.0"), loc },
    ],
    loc,
  };
  const writeUndefined: IrStmt = {
    kind: "for",
    init: decl("j.0", valueCount),
    cond: lt(j, copyFirst ? n : add(valueCount, undefinedCount)),
    update: inc("j.0"),
    body: [{ kind: "arraySetUndefined", arr: a, index: j, loc }],
    loc,
  };
  const deleteRemaining: IrStmt = {
    kind: "for",
    init: decl("j.0", add(valueCount, undefinedCount)),
    cond: lt(j, n),
    update: inc("j.0"),
    body: [{ kind: "arrayDelete", arr: a, index: j, loc }],
    loc,
  };
  const body: IrStmt[] = [
    ...(copyFirst
      ? [assign("a.0", { kind: "arrIntrinsic", method: "slice", receiver: a, args: [], type: arrT, loc })]
      : []),
    readArrayLength(arrT, loc),
    decl("src.0", { kind: "arrayLit", elems: [], type: arrT, loc }),
    decl("valueCount.0", numLit(0, loc)),
    decl("undefinedCount.0", numLit(0, loc)),
    collect,
    // `dst` aliases `src` until a merge needs its own buffer.
    decl("dst.0", src),
    ...runScan,
    merge,
    writeValues,
    writeUndefined,
    ...(copyFirst ? [] : [deleteRemaining]),
    { kind: "return", value: a, loc },
  ];
  const f64Local = (id: string): IrLocal => ({ id: `${id}.0`, name: id, type: F64, mutable: true });
  const elemLocal = (id: string): IrLocal => ({ id: `${id}.0`, name: id, type: elem, mutable: false });
  return {
    name,
    params: [
      { localId: "a.0", name: "a", type: arrT },
      { localId: "f.0", name: "f", type: fnT },
    ],
    returnType: arrT,
    locals: [
      { id: "a.0", name: "a", type: arrT, mutable: true },
      { id: "f.0", name: "f", type: fnT, mutable: true },
      { id: "n.0", name: "n", type: F64, mutable: false },
      { id: "src.0", name: "src", type: arrT, mutable: true },
      { id: "dst.0", name: "dst", type: arrT, mutable: true },
      { id: "tmp.0", name: "tmp", type: arrT, mutable: true },
      { id: "ends.0", name: "ends", type: endsT, mutable: false },
      { id: "state.0", name: "state", type: F64, mutable: false },
      ...[
        "valueCount", "undefinedCount", "runCount", "minRun", "n0", "rbit", "lo", "hi", "runEnd",
        "p", "q", "bl", "bh", "bm", "mEnd", "la", "lb", "idx", "w", "start", "mid", "right", "left", "r", "k", "i", "j",
      ].map(f64Local),
      ...["v", "vL", "vR", "vM", "pivot", "bL", "bR"].map(elemLocal),
    ],
    body,
    loc,
  };
}


/** TypedArray.prototype.sort / toSorted over `bytesT`: a stable bottom-up merge sort, written back into the
 * receiver (`sort`) or into a copy of it (`toSorted`, `copyFirst`), which the helper returns. Without a comparator
 * the order is numeric (%TypedArray%.prototype.sort's default): a float array puts -0 before +0 and NaN last. A
 * comparator's NaN result counts as 0, as `> 0` does. */
export function buildBytesSortFn(
  name: string,
  bytesT: IrType & { kind: "bytes" },
  arity: number,
  hasComparator: boolean,
  copyFirst: boolean,
  loc: SrcLoc,
): IrFunction {
  const float = bytesT.elem === "f16" || bytesT.elem === "f32" || bytesT.elem === "f64";
  const fnT = funcOf([F64, F64].slice(0, arity), F64);
  const a = varRef("a.0", bytesT, loc);
  const src = varRef("src.0", bytesT, loc);
  const dst = varRef("dst.0", bytesT, loc);
  const n = varRef("n.0", F64, loc);
  const width = varRef("width.0", F64, loc);
  const start = varRef("start.0", F64, loc);
  const mid = varRef("mid.0", F64, loc);
  const right = varRef("right.0", F64, loc);
  const left = varRef("left.0", F64, loc);
  const r = varRef("r.0", F64, loc);
  const k = varRef("k.0", F64, loc);
  const add = (left: IrExpr, right: IrExpr): IrExpr => ({ kind: "bin", op: "+", left, right, type: F64, loc });
  const sub = (left: IrExpr, right: IrExpr): IrExpr => ({ kind: "bin", op: "-", left, right, type: F64, loc });
  const mul = (left: IrExpr, right: IrExpr): IrExpr => ({ kind: "bin", op: "*", left, right, type: F64, loc });
  const lt = (left: IrExpr, right: IrExpr): IrExpr => ({ kind: "bin", op: "<", left, right, type: BOOL, loc });
  const at = (receiver: IrExpr, index: IrExpr): IrExpr => ({
    kind: "bytesIntrinsic",
    method: "get",
    receiver,
    args: [index],
    type: F64,
    loc,
  });
  const cmp = (op: "<" | ">" | "===" | "!==", left: IrExpr, right: IrExpr): IrExpr => ({ kind: "bin", op, left, right, type: BOOL, loc });
  const logical = (op: "&&" | "||", left: IrExpr, right: IrExpr): IrExpr => ({ kind: "logical", op, left, right, type: BOOL, loc });
  const div = (left: IrExpr, right: IrExpr): IrExpr => ({ kind: "bin", op: "/", left, right, type: F64, loc });
  // The default float order: the right value goes first when the left is greater, NaN being the greatest and
  // -0 below +0 (1/-0 is -Infinity).
  const floatGreater = (l: IrExpr, r: IrExpr): IrExpr =>
    logical("&&", cmp("===", r, r), logical("||", cmp("!==", l, l), logical("||", cmp(">", l, r),
      logical("&&", logical("&&", cmp("===", l, numLit(0, loc)), cmp("===", r, numLit(0, loc))),
        cmp(">", div(numLit(1, loc), l), div(numLit(1, loc), r))))));
  const shouldTakeRight = (leftValue: IrExpr, rightValue: IrExpr): IrExpr => !hasComparator && float ? floatGreater(leftValue, rightValue) : ({
    kind: "bin",
    op: ">",
    left: hasComparator
      ? {
          kind: "callValue",
          callee: varRef("f.0", fnT, loc),
          args: [leftValue, rightValue].slice(0, arity),
          type: F64,
          loc,
        }
      : {
          kind: "bin",
          op: "-",
          left: leftValue,
          right: rightValue,
          type: F64,
          loc,
        },
    right: numLit(0, loc),
    type: BOOL,
    loc,
  });
  const copyRange: IrStmt = {
    kind: "while",
    cond: lt(k, right),
    body: [
      { kind: "varDecl", localId: "v.0", init: at(src, k), loc },
      { kind: "bytesSet", arr: dst, index: k, value: varRef("v.0", F64, loc), loc },
      { kind: "assign", localId: "k.0", value: add(k, numLit(1, loc)), loc },
    ],
    loc,
  };
  const mergeBody: IrStmt[] = [
    {
      kind: "while",
      cond: {
        kind: "logical",
        op: "&&",
        left: lt(left, mid),
        right: lt(r, right),
        type: BOOL,
        loc,
      },
      body: [
        { kind: "varDecl", localId: "vL.0", init: at(src, left), loc },
        { kind: "varDecl", localId: "vR.0", init: at(src, r), loc },
        {
          kind: "if",
          cond: shouldTakeRight(varRef("vL.0", F64, loc), varRef("vR.0", F64, loc)),
          then: [
            { kind: "bytesSet", arr: dst, index: k, value: varRef("vR.0", F64, loc), loc },
            { kind: "assign", localId: "r.0", value: add(r, numLit(1, loc)), loc },
          ],
          else_: [
            { kind: "bytesSet", arr: dst, index: k, value: varRef("vL.0", F64, loc), loc },
            { kind: "assign", localId: "left.0", value: add(left, numLit(1, loc)), loc },
          ],
          loc,
        },
        { kind: "assign", localId: "k.0", value: add(k, numLit(1, loc)), loc },
      ],
      loc,
    },
    {
      kind: "while",
      cond: lt(left, mid),
      body: [
        { kind: "varDecl", localId: "v.0", init: at(src, left), loc },
        { kind: "bytesSet", arr: dst, index: k, value: varRef("v.0", F64, loc), loc },
        { kind: "assign", localId: "left.0", value: add(left, numLit(1, loc)), loc },
        { kind: "assign", localId: "k.0", value: add(k, numLit(1, loc)), loc },
      ],
      loc,
    },
    {
      kind: "while",
      cond: lt(r, right),
      body: [
        { kind: "varDecl", localId: "v.0", init: at(src, r), loc },
        { kind: "bytesSet", arr: dst, index: k, value: varRef("v.0", F64, loc), loc },
        { kind: "assign", localId: "r.0", value: add(r, numLit(1, loc)), loc },
        { kind: "assign", localId: "k.0", value: add(k, numLit(1, loc)), loc },
      ],
      loc,
    },
  ];
  const mergeOrCopy: IrStmt = {
    kind: "if",
    cond: lt(mid, right),
    then: [
      { kind: "varDecl", localId: "boundaryL.0", init: at(src, sub(mid, numLit(1, loc))), loc },
      { kind: "varDecl", localId: "boundaryR.0", init: at(src, mid), loc },
      {
        kind: "if",
        cond: shouldTakeRight(varRef("boundaryL.0", F64, loc), varRef("boundaryR.0", F64, loc)),
        then: mergeBody,
        else_: [copyRange],
        loc,
      },
    ],
    else_: [copyRange],
    loc,
  };
  const mergePass: IrStmt = {
    kind: "for",
    init: { kind: "varDecl", localId: "start.0", init: numLit(0, loc), loc },
    cond: lt(start, n),
    update: { kind: "assign", localId: "start.0", value: add(start, add(width, width)), loc },
    body: [
      {
        kind: "varDecl",
        localId: "mid.0",
        init: {
          kind: "ternary",
          cond: lt(add(start, width), n),
          then: add(start, width),
          else_: n,
          type: F64,
          loc,
        },
        loc,
      },
      {
        kind: "varDecl",
        localId: "right.0",
        init: {
          kind: "ternary",
          cond: lt(add(add(start, width), width), n),
          then: add(add(start, width), width),
          else_: n,
          type: F64,
          loc,
        },
        loc,
      },
      { kind: "varDecl", localId: "left.0", init: start, loc },
      { kind: "varDecl", localId: "r.0", init: mid, loc },
      { kind: "varDecl", localId: "k.0", init: start, loc },
      mergeOrCopy,
    ],
    loc,
  };
  const params: IrParam[] = [
    { localId: "a.0", name: "a", type: bytesT },
    ...(hasComparator ? [{ localId: "f.0", name: "f", type: fnT }] : []),
  ];
  const locals: IrLocal[] = [
    { id: "a.0", name: "a", type: bytesT, mutable: true },
    ...(hasComparator ? [{ id: "f.0", name: "f", type: fnT, mutable: true }] : []),
    { id: "n.0", name: "n", type: F64, mutable: false },
    { id: "src.0", name: "src", type: bytesT, mutable: true },
    { id: "dst.0", name: "dst", type: bytesT, mutable: true },
    { id: "width.0", name: "width", type: F64, mutable: true },
    { id: "start.0", name: "start", type: F64, mutable: true },
    { id: "mid.0", name: "mid", type: F64, mutable: true },
    { id: "right.0", name: "right", type: F64, mutable: true },
    { id: "left.0", name: "left", type: F64, mutable: true },
    { id: "r.0", name: "r", type: F64, mutable: true },
    { id: "k.0", name: "k", type: F64, mutable: true },
    { id: "i.0", name: "i", type: F64, mutable: true },
    { id: "tmp.0", name: "tmp", type: bytesT, mutable: true },
    { id: "v.0", name: "v", type: F64, mutable: false },
    { id: "vL.0", name: "vL", type: F64, mutable: false },
    { id: "vR.0", name: "vR", type: F64, mutable: false },
    { id: "boundaryL.0", name: "boundaryL", type: F64, mutable: false },
    { id: "boundaryR.0", name: "boundaryR", type: F64, mutable: false },
  ];
  const slice = (receiver: IrExpr): IrExpr => ({
    kind: "bytesIntrinsic",
    method: "slice",
    receiver,
    args: [],
    type: bytesT,
    loc,
  });
  const body: IrStmt[] = [
    ...(copyFirst ? [{ kind: "assign" as const, localId: "a.0", value: slice(a), loc }] : []),
    { kind: "varDecl", localId: "n.0", init: { kind: "bytesIntrinsic", method: "length", receiver: a, args: [], type: F64, loc }, loc },
    { kind: "varDecl", localId: "src.0", init: slice(a), loc },
    { kind: "varDecl", localId: "dst.0", init: slice(a), loc },
    { kind: "varDecl", localId: "width.0", init: numLit(1, loc), loc },
    {
      kind: "while",
      cond: lt(width, n),
      body: [
        mergePass,
        { kind: "varDecl", localId: "tmp.0", init: src, loc },
        { kind: "assign", localId: "src.0", value: dst, loc },
        { kind: "assign", localId: "dst.0", value: varRef("tmp.0", bytesT, loc), loc },
        { kind: "assign", localId: "width.0", value: mul(width, numLit(2, loc)), loc },
      ],
      loc,
    },
    {
      kind: "for",
      init: { kind: "varDecl", localId: "i.0", init: numLit(0, loc), loc },
      cond: lt(varRef("i.0", F64, loc), n),
      update: { kind: "assign", localId: "i.0", value: add(varRef("i.0", F64, loc), numLit(1, loc)), loc },
      body: [
        { kind: "varDecl", localId: "v.0", init: at(src, varRef("i.0", F64, loc)), loc },
        { kind: "bytesSet", arr: a, index: varRef("i.0", F64, loc), value: varRef("v.0", F64, loc), loc },
      ],
      loc,
    },
    { kind: "return", value: a, loc },
  ];
  return { name, params, returnType: bytesT, locals, body, loc };
}
