// This file was modified from scriptc (Apache-2.0); see MODIFICATIONS.md.
/* scriptc runtime — numbers, String.fromCharCode, Number statics, Date and
 * numeric coercion (scr_number.c, scr_lib.c). Included by scr_runtime.h,
 * which says where new declarations go. */
#ifndef SCR_NUMBER_H
#define SCR_NUMBER_H

#include "scr_events.h"

/* ── dynamic island (scr_island.c; --dynamic builds ONLY) ────────────
 * The embedded QuickJS-ng engine. Compiled and linked only under
 * -DSCR_DYNAMIC; static builds never reference these symbols (nor the
 * engine headers — this block deliberately names no engine type). One
 * runtime+context per process, created lazily on first entry, torn down
 * at exit before the RC audit; every entry re-anchors the engine's
 * stack-overflow check so calls from ucontext fibers are safe. Not
 * reentrant from engine callbacks.
 */
#ifdef SCR_DYNAMIC
/* Evaluate UTF-8 source in the island's global scope; returns
 * String(result) as a +1 ScrStr. Borrows code. An island exception is
 * bridged into the exception cell as a catchable string ("TypeError:
 * boom" — String(e)) and NULL comes back — callers are compiler-emitted
 * pending checks (may-throw, like the fs.* surface). */
ScrStr *scr_island_eval(ScrStr *code);

/* The libregexp opaque for scr_regex.c (--dynamic builds share the engine
 * archive's libregexp, whose host hooks want the island's JSContext):
 * lazily boots the engine and re-anchors its stack check, then hands the
 * context out as an opaque pointer. */
void *scr_island_lre_opaque(void);

/* ── embedded npm modules ─────────────────────────────────────────────
 * npm package code is embedded into the binary at BUILD time: the emitted
 * C carries every reached module's source as a static string plus the
 * (importer, specifier) → target resolution edges, and registers both
 * tables at the top of main. The island's module loader and its CommonJS
 * require shim resolve exclusively from these tables — binaries never
 * read node_modules at runtime. Edge targets are module keys or "node:*"
 * builtins, which the island shims (events, path, process, fs stubs,
 * child_process stubs). */
typedef struct ScrIslandModule {
  const char *key; /* resolved path — the loader's cache key */
  /* UTF-8 source — or raw-DEFLATE bytes when src_raw > 0 (the emitter
   * compresses big module texts; the loader inflates LAZILY at first
   * load through the inflater the emitted main installs, so a module a
   * run never loads never inflates — and its pages never fault in). */
  const char *src;
  size_t len;      /* byte length of src AS STORED */
  size_t src_raw;  /* 0: src is plain text; else the inflated byte length */
  int format; /* 0 = ESM, 1 = CommonJS, 2 = JSON */
  /* CommonJS only: the ESM facade the loader evaluates when an ES module
   * imports this file — default (module.exports itself) plus the named
   * exports LEXED from the source at BUILD time with the compiler's port
   * of Node's vendored CJS lexer. NULL for ESM sources (compiled
   * natively) and JSON (default-only wrapper, like Node). The same
   * compression contract as src, via esm_raw. */
  const char *esm;
  size_t esm_len;
  size_t esm_raw;
} ScrIslandModule;

typedef struct ScrIslandEdge {
  const char *from;
  const char *spec;
  const char *to;
  /* Which call forms this resolution serves — Node picks the "exports"
   * condition set from the CALL FORM, so a dual package embeds TWO edges
   * for one (from, spec): its "import" condition's target behind kind 1
   * and its "require" condition's behind kind 2. 0 answers both lookups
   * (relative files, builtins). */
  int kind; /* 0 = any, 1 = import, 2 = require */
} ScrIslandEdge;

/* Registers the emitted tables (static data; no copy, no engine boot).
 * Must run before any island entry that imports — main calls it right
 * after scr_lib_init. */
void scr_island_modules(const ScrIslandModule *mods, size_t nmods,
                         const ScrIslandEdge *edges, size_t nedges);
/* The logical source entry, independent of the installed binary path. */
void scr_island_entry_module(const char *filename);

/* The inflater for compressed embedded module text (raw DEFLATE, exact
 * inflated size known from the table row). The emitted main installs
 * scr_zlib.c's scr_zlib_inflate_exact exactly when some module compressed
 * at build time — index.ts links scr_zlib.c/libz on the same predicate,
 * so compression-free builds keep their link line and the island keeps no
 * zlib reference of its own. */
void scr_island_set_inflate(bool (*inflate)(const unsigned char *src, size_t src_len,
                                            unsigned char *dst, size_t dst_len));
/* scr_zlib.c: one-shot raw-DEFLATE inflate into a caller-sized buffer;
 * true only when the stream ends exactly at dst_len. */
bool scr_zlib_inflate_exact(const unsigned char *src, size_t src_len,
                            unsigned char *dst, size_t dst_len);

/* The island process shim's implicit exit status (process.exitCode):
 * Node's set-it-and-return-normally contract. The emitted main returns
 * this after the loop drains; 0 when never set. The version advances on
 * every assignment so an exit listener can override a provisional status. */
int scr_island_exit_code(void);
size_t scr_island_exit_code_version(void);

/* ── web-platform globals (scr_web.c) ─────────────────────────────────
 * The pure-JS prelude defining the island's WHATWG subset (streams et
 * al.), evaluated at engine boot before any embedded module. `jsctx` is
 * the island's JSContext as an opaque pointer — engine types stay out of
 * this header. */
void scr_island_web_boot(void *jsctx);

/* Runs the engine's pending promise-reaction jobs to exhaustion (no-op
 * before the engine boots). Returns the number executed. The loop's io
 * hook drains through this so island async chains progress at quiescence,
 * exactly where Node runs its microtasks. */
int scr_island_drain_jobs(void);

/* Re-anchors the engine's stack-overflow check to the CURRENT stack (the
 * every-island-entry rule) — for units entering the engine from loop
 * dispatch stations (the fetch bridge's net callbacks) rather than
 * through an emitted island op. */
void scr_island_host_enter(void);

/* Bridges the engine's CURRENT pending exception into the scriptc
 * pending cell (the island timer bridge fires engine callbacks from the
 * static heap; a throw there must become the loop's uncaught report). */
void scr_island_bridge_exception(void);

/* ── island timers (scr_web.c) ────────────────────────────────────────
 * The machinery behind AbortSignal.timeout: one-shot engine callbacks
 * armed by the web prelude's host.timer. Deliberately UNREF'd, like
 * Node's AbortSignal.timeout timer — an armed timer never keeps the loop
 * alive; it fires only if other work (a live transfer, engine jobs) keeps
 * the process running, and the island's io hook caps its sleeps at the
 * earliest deadline so a fetch timeout fires on time. Deadlines are on
 * the scr_now_ms clock; _deadline returns HUGE_VAL when none are armed.
 * Teardown frees unfired callbacks so the engine audit stays zero. */
double scr_island_timers_deadline(void);
bool scr_island_timers_due(void);
bool scr_island_timers_fire_due(void); /* true = fired at least one */
void scr_island_timers_teardown(void);

/* ── dynamic fetch hooks ──────────────────────────────────────────────
 * The native bridge registers NO pending/poll hooks (its
 * transfers live on real sockets the loop's poller sleeps on); the curl
 * reference implementation (scr_fetch_curl.c, SCRIPTC_FETCH_CURL=1 —
 * one release as the flip's reference) still registers all four so the
 * loop can sleep on curl's fds. */
void scr_island_set_fetch(void (*boot)(void *jsctx), bool (*pending)(void),
                           void (*poll)(double max_wait_ms), void (*teardown)(void));

/* ── the island's node:http/https client bridge (scr_net_island.c) ────
 * The one TU referencing BOTH the socket units and the island (the
 * scr_zlib_island.c precedent): native-toolchain.ts compiles it exactly when a
 * --dynamic build links the socket units, and the emitted main calls
 * scr_net_island_install before any island entry. `attach` runs while
 * the island builds its bootstrap host object (jsctx and host_obj are
 * the engine's context and host-object pointers, opaque here — engine
 * types stay out of this header) and adds the bridge's host functions; `teardown`
 * frees engine values still held by in-flight requests before the
 * engine dies, the fetch-teardown story. Without the bridge the island
 * keeps its "does not provide the 'node:http' builtin" refusal. */
void scr_island_set_netmod(void (*attach)(void *jsctx, void *host_obj), void (*teardown)(void));
void scr_net_island_install(void);

/* ── island value handles (the `any` runtime type) ────────────────────
 * A ScrJsval is an ordinary refcounted scriptc heap cell owning ONE
 * engine value. It is opaque here (the engine's value type must not leak
 * into static-build translation units) and deliberately NOT
 * cycle-collector-traced: its internal references live in the engine's
 * own GC world, and cycles that cross the boundary are documented as
 * uncollectable (SEMANTICS.md). Releasing the last reference frees the
 * engine value — or only the cell itself after engine teardown (the
 * engine frees every value it still owns when it goes down, so a
 * post-teardown release must not touch it).
 *
 * Conventions, mirroring the rest of the runtime: operands are BORROWED,
 * refcounted results come back owned (+1). Fallible operations bridge
 * the engine exception into the exception cell (catchable) and report
 * failure via NULL (pointer results) or -1 (int results) — callers are
 * compiler-emitted pending checks. Every entry re-anchors the engine's
 * stack check, so all of these are fiber-safe. */
typedef struct ScrJsval ScrJsval;

ScrJsval *scr_jsval_retain(ScrJsval *v);
void scr_jsval_release(ScrJsval *v);
void *scr_jsval_retain_v(void *v);
void scr_jsval_release_v(void *v);

/* Binary operator codes for scr_jsval_binop / scr_jsval_cmp. The JS
 * semantics (ToPrimitive, coercion) come from prelude helper closures
 * evaluated at island init, not from C reimplementations. */
#define SCR_JSOP_ADD 0
#define SCR_JSOP_SUB 1
#define SCR_JSOP_MUL 2
#define SCR_JSOP_DIV 3
#define SCR_JSOP_MOD 4
#define SCR_JSOP_POW 5
#define SCR_JSOP_LT 6
#define SCR_JSOP_LE 7
#define SCR_JSOP_GT 8
#define SCR_JSOP_GE 9
#define SCR_JSOP_EQ 10  /* strict === */
#define SCR_JSOP_NEQ 11 /* strict !== */
#define SCR_JSOP_COUNT 12

/* Marshal in (static → island). Each returns a fresh +1 cell. from_str
 * borrows s; from_json borrows JSON text produced by the emitted
 * type-directed serializers (a DEEP COPY into the island — the documented
 * aliasing divergence) and cannot fail on that trusted input. */
ScrJsval *scr_jsval_from_f64(double v);
ScrJsval *scr_jsval_from_bool(bool v);
ScrJsval *scr_jsval_from_str(const ScrStr *s);
ScrJsval *scr_jsval_from_json(const ScrStr *json);
/* A CHECKED-DYNAMIC (dyn) value entering the island — deep copy for data
 * kinds (a boxed handle/promise throws the catchable TypeError). A JSVAL
 * node unwraps to its OWN cell (+1) — an engine value that crossed into
 * the checked-dynamic tree and back is the SAME engine value, by reference (nested JSVAL
 * members embed their engine values directly). A boxed FUNCTION crosses
 * as one generic host-function shim over its uniform ScrDynThunk: the
 * shim wraps engine arguments as dyn values (scalar-normalizing), calls
 * the thunk, and converts the dyn result back — each crossing mints a
 * fresh engine function (identity is not preserved for re-crossings;
 * SEMANTICS.md). NULL with a pending exception on failure. Borrows d. */
ScrJsval *scr_jsval_from_dyn(const ScrDyn *d);

/* The jsval→dyn crossing (the IR's dynFromJsval): wraps an island value
 * as a SCR_DYN_JSVAL node, SCALAR-NORMALIZING first — engine numbers/
 * strings/booleans/null/undefined convert to the native dyn kinds (the
 * strict exits cannot fail on engine-reported scalars), so JSVAL nodes
 * only ever hold engine objects/arrays/functions (and the symbol/bigint
 * edge). Installs the checked-dynamic tree's engine-routing ops on first use. Borrows
 * the cell (retains it into the node); +1 out; never throws. */
ScrDyn *scr_dyn_from_jsval(ScrJsval *cell);

/* Engine operations. Arithmetic yields a fresh cell (NULL = bridged);
 * comparisons yield 0/1 (-1 = bridged); truthy/not never fail. */
ScrJsval *scr_jsval_binop(int op, ScrJsval *a, ScrJsval *b);
int scr_jsval_cmp(int op, ScrJsval *a, ScrJsval *b);
/* `v instanceof C` in the engine (JS_IsInstanceOf — the spec operator,
 * Symbol.hasInstance included). 0/1; -1 = bridged (non-object RHS throws
 * the engine's own TypeError, catchably). */
int scr_jsval_instance_of(ScrJsval *v, ScrJsval *c);
ScrJsval *scr_jsval_neg(ScrJsval *a);
/* GetIterator over an island value (the for-of head over 'any'): the
 * engine's protocol lookup; NULL + pending TypeError when not iterable. */
ScrJsval *scr_jsval_iter_new(ScrJsval *a);
ScrJsval *scr_jsval_plus(ScrJsval *a); /* unary + (ToNumber) */
int scr_jsval_truthy(ScrJsval *a);
ScrStr *scr_jsval_typeof(ScrJsval *a);
bool scr_jsval_is_object(ScrJsval *a);
ScrStr *scr_jsval_to_str(ScrJsval *a); /* String(v); NULL = bridged */

/* Property/element access and calls. Names are NUL-terminated ScrStr
 * (identifier property names from source); computed keys are jsvals. */
ScrJsval *scr_jsval_get_prop(ScrJsval *o, const ScrStr *name);
ScrJsval *scr_jsval_global_get(const ScrStr *name);
/* A compiled value into the island by reference (host island: SCR_HV_PROGRAM). Borrows. */
ScrJsval *scr_jsval_from_program(ScrDyn *d);
int scr_jsval_set_prop(ScrJsval *o, const ScrStr *name, ScrJsval *v);
ScrJsval *scr_jsval_get_idx(ScrJsval *o, ScrJsval *key);
/* Destructuring guards over island values: RequireObjectCoercible with
 * V8's exact TypeError text (pass-through result, +1), and GetIterator +
 * the pattern's width as a fresh engine array (undefined-padded,
 * IteratorClose per spec); both throw catchably, NULL + pending on throw. */
ScrJsval *scr_jsval_destr_check(ScrJsval *v, const char *spell, const char *first);
ScrJsval *scr_jsval_iter_n(ScrJsval *v, double n);
int scr_jsval_set_idx(ScrJsval *o, ScrJsval *key, ScrJsval *v);
ScrJsval *scr_jsval_call_method(ScrJsval *o, const ScrStr *name, int argc, ScrJsval **argv);
ScrJsval *scr_jsval_call_this(ScrJsval *f, ScrJsval *receiver, int argc, ScrJsval **argv);
/* `o.name?.(...)`: a nullish member answers the engine's undefined;
 * anything else calls with this = o (non-callables throw in the engine). */
ScrJsval *scr_jsval_opt_call_method(ScrJsval *o, const ScrStr *name, int argc, ScrJsval **argv);
ScrJsval *scr_jsval_call(ScrJsval *f, int argc, ScrJsval **argv);
/* Spread application on an island callee — `f(...pre, ...spread)` through
 * the prelude helper's REAL spread syntax (iterator protocols are the
 * engine's own; the guards front-run V8's exact spread-call TypeError
 * texts). `pre` is the engine array of leading fixed arguments; `what` the
 * spread expression's source spelling (the nullish text spells it).
 * Borrows everything; +1 out, or NULL with the exception bridged. */
ScrJsval *scr_jsval_call_spread(ScrJsval *f, ScrJsval *pre, ScrJsval *spread, const ScrStr *what);
/* `new X(...)` on an island callee (jsOp construct) — JS_CallConstructor.
 * Borrows everything; +1 out, or NULL with the exception bridged. */
ScrJsval *scr_jsval_construct(ScrJsval *f, int argc, ScrJsval **argv);

/* A scriptc closure entering the island as an engine function (the
 * package-callback pattern: `.action((a, b) => ...)`). `adapt` is the
 * compiler-emitted per-signature adapter — one uniform shape over the
 * closure ABI: borrowed argument cells in (the closure ABI consumes its
 * params, so the adapter retains them), the +1 result cell (or NULL for
 * void) out. The wrapper retains the closure; the engine finalizer
 * releases it (before the RC audit — teardown precedes it). Calls from
 * the engine pad missing arguments with undefined and drop surplus, like
 * any JS call; a scriptc exception thrown inside reverse-bridges to an
 * engine throw (strings stay strings — the two bridges round-trip). */
ScrJsval *scr_jsval_from_closure(ScrClosure *c, int arity,
                                  ScrJsval *(*adapt)(ScrClosure *, ScrJsval **));

/* True iff the cell holds the engine's undefined — the TYPED host-call
 * adapters ask before converting a `T | undefined` parameter (an absent
 * or undefined engine argument takes the undefined arm; anything else
 * converts through the exit machinery). */
bool scr_jsval_is_undefined(ScrJsval *v);

/* Optional chains on island values: the nullish test on the HANDLE
 * (`x?.y` on 'any' — undefined OR null short-circuits, JS-exact) and the
 * engine's own undefined/null as +1 cells (the unit path's result, and
 * the union lift's unit arms). All infallible. */
bool scr_jsval_is_nullish(ScrJsval *v);
ScrJsval *scr_jsval_undefined(void);
ScrJsval *scr_jsval_null(void);

/* Non-JSON marshals IN: a URL crosses as an engine URL instance built
 * from its href (the first call installs a minimal island URL class when
 * no global exists — construction re-parses through scr_url.c's WHATWG
 * parser; href/protocol/pathname readable, other components throw, see
 * SEMANTICS.md). Borrows; +1 cell out, or NULL with the exception
 * bridged. scr_jsval_from_bytes is its typed-array sibling — declared
 * with the bytes surface below. */
ScrJsval *scr_jsval_from_url(ScrUrl *u);

/* Payload tags for scr_jsval_from_promise — the fulfillment types an
 * async island callback may resolve with (the compiler fences the rest). */
enum {
  SCR_ISLP_VOID = 0,
  SCR_ISLP_F64 = 1,
  SCR_ISLP_BOOL = 2,
  SCR_ISLP_STR = 3,
  SCR_ISLP_JSVAL = 4,
  /* Promise<any[]> — the fulfillment is a native array of engine cells
   * (the jsval-element-array spelling): it re-enters the engine as a
   * fresh engine array whose ELEMENTS are the same engine values (the
   * loadPlugins shape: identity crosses, the spine is a copy). */
  SCR_ISLP_JSVAL_ARR = 5,
};

/* Wrap a scriptc promise as an ENGINE promise (async callbacks crossing
 * into the island: the package sees a real thenable). Takes ownership of
 * `p` (+1 moves in). A waiter fiber awaits it and settles the engine
 * capability when it settles — fulfillment marshals per `payload`
 * (SCR_ISLP_*), rejection reverse-bridges the reason (Errors cross as
 * real engine Errors). The await OBSERVES a rejection for the static
 * ledger, and the engine's rejection tracker takes over for the wrapper
 * promise — one report, one voice, whichever world drops the ball.
 * Wrappers still pending at teardown free their engine values then (the
 * island audit sees zero live allocations). NULL only if the engine
 * cannot mint a capability (exception bridged). */
ScrJsval *scr_jsval_from_promise(ScrPromise *p, int payload);

/* The REVERSE bridge: an ENGINE promise (a package call's jsval whose
 * declared type is Promise<T>) settles a fresh STATIC promise, so
 * `await pkgCall()` parks a fiber and `.catch/.finally` desugar over it.
 * Borrows `v`; the +1 result is pending until the engine promise settles
 * (subscription is Promise.resolve(v).then(onF, onR) through a pinned
 * prelude helper — thenables and plain values behave like `await`).
 * Fulfillment stores the retained value cell (SCR_ISLP_JSVAL) or nothing
 * (SCR_ISLP_VOID; the compiler passes no other tags); rejection converts
 * the reason exactly like a bridged exception (engine Errors become
 * ScrErrors picked by name) and rejects — re-thrown at the await,
 * ledger-tracked if never observed. The .then marks the engine promise
 * HANDLED for the island's rejection tracker, so exactly one world
 * reports a dropped rejection. Bridging the same engine promise twice
 * just makes two static observers of one settlement. NULL only on an
 * engine-level surprise minting the subscription (exception bridged). */
ScrPromise *scr_jsval_bridge_promise(ScrJsval *v, int payload);

/* Island-native literals: build an object from key/value pairs (keys are
 * marshaled strings) or an array from elements. Borrow argv; +1 out.
 * Cannot fail (allocation failure aborts, like every runtime OOM). */
ScrJsval *scr_jsval_obj_lit(int npairs, ScrJsval **kv);
/* Getter completion for an island literal: defines `key` on `obj` as an
 * engine getter invoking `fn`; answers the object retained (+1). */
ScrJsval *scr_jsval_define_getter(ScrJsval *obj, ScrJsval *key, ScrJsval *fn);
/* The engine TemplateStringsArray for an island tag call: n cooked then n
 * raw strings; the result array carries `.raw` (+1). */
ScrJsval *scr_jsval_tpl_strings(int n, ScrJsval **kv);
/* Spread completion for an island literal: engine CopyDataProperties of
 * `src` onto `obj`; answers the target (+1), NULL + pending on a getter
 * throw. */
ScrJsval *scr_jsval_obj_spread(ScrJsval *obj, ScrJsval *src);
ScrJsval *scr_jsval_arr_lit(int n, ScrJsval **elems);

/* Marshal out (island → static): validated, STRICT extraction — a
 * non-number refuses to exit as number (no coercion), throwing a
 * catchable path-less TypeError like the dynCheck walkers'. Composite
 * targets exit via scr_jsval_to_json + the existing json.parse +
 * dynCheck pipeline instead (to_json throws if the value is not
 * JSON-representable, e.g. contains a function). */
int scr_jsval_exit_f64(ScrJsval *v, double *out);
int scr_jsval_exit_bool(ScrJsval *v, bool *out);
ScrStr *scr_jsval_exit_str(ScrJsval *v);
/* Uint8Array exit (engine Buffers pass — they ARE Uint8Arrays): a fresh
 * u8 COPY (+1), the boundary's aliasing stance; NULL = thrown. */
ScrBytes *scr_jsval_exit_bytes(ScrJsval *v);
/* `any[]`-declared slot exit (the jsval-element-array spelling):
 * Array.isArray-gated, elements BY REFERENCE into a native array of
 * engine cells (identity crosses, the spine is a snapshot copy). +1;
 * NULL = thrown. */
ScrArr *scr_jsval_exit_jsval_arr(ScrJsval *v);
ScrStr *scr_jsval_to_json(ScrJsval *v);

/* The import boundary (libCall island.import): loads an embedded module —
 * the package's runtime entry — through the island's module system and
 * takes one export as an owned (+1) jsval. `name` is an export name,
 * "default", or "*" (the namespace object; for CommonJS entries, an
 * interop object over module.exports). The engine's module registry (and
 * the require shim's cache) make repeated imports lookups, not
 * re-evaluations. `specifier` is the specifier as WRITTEN at the import
 * site: an ESM entry that does not provide a requested named export
 * throws Node's link-time SyntaxError naming it ("The requested module
 * 'x' does not provide an export named 'y'"). Borrows all args. NULL =
 * bridged exception (a package's top-level code can throw). */
ScrJsval *scr_jsval_import(const ScrStr *key, const ScrStr *name, const ScrStr *specifier);

/* Dynamic import() (libCall island.importDyn): loads a module — an
 * embedded module's key or a builtin shim's "node:x" key — through the
 * island's module system and answers an owned (+1) jsval holding an
 * ENGINE PROMISE of the namespace object. ALWAYS a promise: load and
 * evaluation failures REJECT it (Node's dynamic-import shape). Borrows
 * the key. NULL only on an engine-level surprise minting the rejected
 * promise. */
ScrJsval *scr_jsval_import_dyn(const ScrStr *key);

/* The deferred boundary failure (libCall island.castFail): throws a
 * catchable TypeError naming the target type — a checked cast of an
 * island value to a type with no validated exit fails at RUNTIME, at the
 * cast, instead of refusing the build. Borrows both args; the exception
 * is pending on return. */
void scr_jsval_cast_fail(ScrJsval *v, const ScrStr *target);
#endif /* SCR_DYNAMIC */

/* ── numbers ────────────────────────────────────────────────────────────
 * JS-exact Number-to-string (ECMA-262 §6.1.6.1.20 Number::toString, radix
 * 10): shortest digit string that round-trips, ECMA placement rules.
 * Writes NUL-terminated result into buf (>= 32 bytes), returns length.
 */
size_t scr_f64_to_str(double x, char *buf);

/* The Ryū digit core (scr_number.c), shared with the Intl en-US number
 * formatter: the shortest round-tripping digits of a POSITIVE finite
 * double — value = 0.digits × 10^n, no trailing zeros, NUL-terminated.
 * Returns k, the digit count (≤ 17). */
int scr_f64_digits(double x, char digits[18], int *n_out);

/* Clinger's exact fast path for a VALIDATED decimal span ([+-]? digits
 * with optional fraction and exponent; no whitespace, no Infinity): sets
 * *out and returns true when the value is m × 10^e with m <= 2^53 and a
 * small |e| (one correctly rounded multiply/divide, bit-identical to
 * strtod); false means the caller must take its strtod path. */
bool scr_decimal_fast(const char *p, size_t n, double *out);
/* The same fast path with whole-span validation folded into its scan: -1
 * when p[0..n) is not such a decimal literal, 1 with *out set when exact,
 * 0 when valid but the caller must use strtod. */
int scr_decimal_scan(const char *p, size_t n, double *out);

/* Number.prototype.toFixed's digit string for finite |x| < 1e21 and
 * 0 <= f <= 100: the spec's n (closest to |x| × 10^f on the EXACT binary
 * value, ties up) with the point placed f digits from the right and "-"
 * for x < 0. Writes NUL-terminated text into buf (>= 128 bytes); returns
 * the length. */
size_t scr_f64_to_fixed(double x, int f, char *buf);

/* toPrecision / toExponential(fractionDigits) digits for POSITIVE finite
 * a and 1 <= p <= 101: the spec's p-digit n (ties to the larger n on the
 * exact binary value) into digits (NUL-terminated, >= p + 1 bytes) and its
 * decimal exponent e (value ~ d.ddd x 10^e) into *e_out. Returns p. */
int scr_f64_precision_digits(double a, int p, char *digits, int *e_out);

/* ToString for template literals / string coercion. Returns +1. */
ScrStr *scr_f64_to_scrstr(double x);
ScrStr *scr_bool_to_scrstr(bool b); /* interned "true"/"false" */

/* ── String surface (scr_lib.c) ───────────────────────────────────────
 * fromCharCode: ONE packed f64[] of UTF-16 code units — ToUint16 each,
 * adjacent surrogate pairs combine, other surrogates stay lone. Borrowed
 * args; the string result is +1; neither throws. */
ScrStr *scr_str_from_char_code(ScrArr *codes);
/* String.fromCharCode over n codes in a caller-owned array (no ScrArr). */
ScrStr *scr_str_from_char_codes(const double *codes, size_t n);
/* Single numeric argument; avoids argument packing. Defined in scr_string.c
 * to share its character cache. Same ToUint16 and lone-surrogate behavior. */
ScrStr *scr_str_from_char_code_one(double code);
/* The spread-typed-array form (String.fromCharCode(...bytes) — the
 * magic-number ASCII probe); same semantics per element. */
ScrStr *scr_str_from_char_code_bytes(ScrBytes *codes);
/* Numeric Unicode code points, borrowed source; +1 string or NULL with
 * a pending RangeError. Adjacent surrogate code points combine. */
ScrStr *scr_str_from_code_point(ScrArr *codes);
ScrStr *scr_str_from_code_point_bytes(ScrBytes *codes);

/* ── Number statics (scr_lib.c) ───────────────────────────────────────
 * JS-exact by construction: Number.isFinite/isNaN/isInteger/isSafeInteger
 * never coerce, and the compiler only routes f64-typed arguments here.
 * None throws. */
bool scr_num_is_finite(double x);
bool scr_num_is_nan(double x);
bool scr_num_is_integer(double x);
bool scr_num_is_safe_integer(double x);
/* Number.prototype formatters: toExponential() is the fraction-digits-free
 * shortest correctly-rounded mantissa; toFixed0 is the non-throwing omitted
 * argument form. toFixed implements an explicit 0..100 fractionDigits with
 * exact binary-value rounding and THROWS V8's catchable RangeError outside
 * that range. All successful results are +1. */
ScrStr *scr_num_to_exponential(double x);
ScrStr *scr_num_to_fixed0(double x);
ScrStr *scr_num_to_fixed(double x, double fraction_digits);
/* Number.prototype.toPrecision(precision) and toExponential(fractionDigits)
 * with the argument already coerced (has_precision false = undefined).
 * Invalid digit counts throw V8's RangeError (NULL). Result +1. */
ScrStr *scr_num_to_precision(double x, double precision, bool has_precision);
ScrStr *scr_num_to_exponential_digits(double x, double fraction_digits);
ScrStr *scr_num_to_string_radix_f64(double value, double radix);

/* Object.is over two numbers — the spec's SameValue on doubles: NaN
 * equals NaN, +0 differs from -0, everything else is ==. Never throws. */
bool scr_num_same_value(double a, double b);

/* Intl.NumberFormat("en-US").format(x) / x.toLocaleString("en-US") with
 * default options: decimal notation, 0–3 fraction digits rounded half-up
 * on the shortest round-tripping decimal (ICU's rounding input — NOT
 * toFixed's exact-value rounding), "," grouping every three integer
 * digits, "∞"/"NaN" texts, "-0" for negative inputs rounding to zero.
 * en-US is the one embedded locale. Result +1; never throws. */
ScrStr *scr_intl_num_format_en_us(double x);

/* ── Date, the read-only value slice (scr_lib.c) ──────────────────────
 * A Date value is its TimeClip'd epoch-millisecond scalar. Identity and
 * mutation are frontend-fenced; construction, storage, getters, and ISO
 * formatting are exact over this representation. */
double scr_date_now(void); /* integer ms since epoch, like Node */
/* The clock of the MockTimers that mocks Date (scr_test.c), NULL while
 * Date is not mocked. Dynamic `new Date()` reads it; the runtime's own
 * time stamps keep scr_date_now, as Node's internals keep the real Date. */
extern SCR_TL const double *scr_date_mock_now;
double scr_date_new_ms(double ms); /* TimeClip (NaN when invalid) */
double scr_date_get_time(double ms);
/* Date.prototype's setters (setMilliseconds ... setFullYear and their UTC
 * forms) over a time value: the new time value for `argc` arguments
 * `a`..`d` (scr_lib.c). `setter` is an SCR_DATE_SET_* code; it and `argc`
 * are whole numbers passed as doubles, as the compiler's lib calls pass
 * numbers. */
enum {
  SCR_DATE_SET_MILLISECONDS = 0,
  SCR_DATE_SET_SECONDS = 1,
  SCR_DATE_SET_MINUTES = 2,
  SCR_DATE_SET_HOURS = 3,
  SCR_DATE_SET_DATE = 4,
  SCR_DATE_SET_MONTH = 5,
  SCR_DATE_SET_FULL_YEAR = 6,
  SCR_DATE_SET_UTC = 8,
};
double scr_date_set_fields(double t, double setter, double argc,
                           double a, double b, double c, double d);
/* A Date object: the TimeClip'd time value in milliseconds (NaN for an
 * invalid date). Dates are immutable; their identity is the pointer.
 * Retain/release follow the runtime's RC conventions (SIZE_MAX immortal). */
typedef struct ScrDate {
  size_t rc;
  double ms;
} ScrDate;
ScrDate *scr_date_new(double ms); /* +1 */
ScrDate *scr_date_retain(ScrDate *date);
void scr_date_release(ScrDate *date);
void *scr_date_retain_v(void *p);
void scr_date_release_v(void *p);
/* Node's exact ISO 8601 UTC format (expanded ±YYYYYY years outside
 * 0–9999). THROWS Node's "Invalid time value" RangeError on NaN or
 * |ms| > 8.64e15 and returns NULL; +1 otherwise. */
ScrStr *scr_date_to_iso(double ms);
ScrStr *scr_date_to_string_form(double ms, double form);
/* Node's Date.prototype.toUTCString ("Thu, 01 Jan 1970 00:00:00 GMT";
 * "Invalid Date" for NaN). Never throws; +1. */
ScrStr *scr_date_to_utc_string(double ms);
/* The BOUNDED parse (the X509 validity shape + ECMA's format with an
 * explicit offset); NaN elsewhere. */
double scr_date_parse_get_time(ScrStr *s);
/* Date.parse and new Date(dateString): V8's date parser (the ES5 format,
 * then its legacy grammar: RFC 1123/2822, Date#toString, "Jan 2, 2024",
 * ...). Zone-less dates are local time. Never throws. */
double scr_date_parse(ScrStr *s);
/* new Date(year, monthIndex, date, hours, minutes, seconds, ms) over
 * already-number arguments: V8's MakeDay/MakeTime over LOCAL fields, then
 * UTC(t) in the host zone and TimeClip. Never throws. */
double scr_date_new_local(double y, double mo, double d,
                          double h, double mi, double s, double ms);
/* Date.UTC over already-number arguments (frontend completes the spec's
 * defaults): MakeDay/MakeTime/TimeClip exactly — 0–99 maps to 1900+year,
 * month/date rollover, NaN for non-finite parts, out-of-range results,
 * and years past V8's ±1e6 MakeDay bound. Never throws. */
double scr_date_utc(double y, double mo, double d,
                    double h, double mi, double s, double ms);
double scr_date_get_full_year(double ms, bool utc);
double scr_date_get_month(double ms, bool utc);
double scr_date_get_date(double ms, bool utc);
double scr_date_get_day(double ms, bool utc);
double scr_date_get_hours(double ms, bool utc);
double scr_date_get_minutes(double ms, bool utc);
double scr_date_get_seconds(double ms, bool utc);
double scr_date_get_milliseconds(double ms);
double scr_date_get_timezone_offset(double ms);
/* Date.prototype.toString, toDateString and toTimeString with V8's
 * formats; "Invalid Date" for NaN. +1. */
ScrStr *scr_date_to_string(double ms);
ScrStr *scr_date_to_date_string(double ms);
ScrStr *scr_date_to_time_string(double ms);
/* String() of a Date object (ScrDate *), and Array.prototype.join over an
 * array of Date objects (holes empty). +1. */
ScrStr *scr_date_object_to_string(void *date);
struct ScrArr;
ScrStr *scr_date_arr_join(struct ScrArr *dates, const ScrStr *sep);
/* The long time zone name Node prints after the GMT offset for the host
 * zone at time value `ms`; `isdst` is tm_isdst at `ms`, or -1 when not
 * known. Borrowed; valid until the next call on the same thread. */
const char *scr_date_zone_name(double ms, int isdst);
/* One-argument ABI wrappers used by the LLVM lib-call table. */
double scr_date_get_full_year_local(double ms);
double scr_date_get_full_year_utc(double ms);
double scr_date_get_month_local(double ms);
double scr_date_get_month_utc(double ms);
double scr_date_get_date_local(double ms);
double scr_date_get_date_utc(double ms);
double scr_date_get_day_local(double ms);
double scr_date_get_day_utc(double ms);
double scr_date_get_hours_local(double ms);
double scr_date_get_hours_utc(double ms);
double scr_date_get_minutes_local(double ms);
double scr_date_get_minutes_utc(double ms);
double scr_date_get_seconds_local(double ms);
double scr_date_get_seconds_utc(double ms);

/* ── numeric coercion + bitwise operators ─────────────────────────────
 * JS-exact ToInt32/ToUint32 semantics: NaN/±Infinity → 0, truncation
 * toward zero, modular wrap into 32 bits; the operation runs in 32-bit
 * space (shift counts mask to 5 bits, `>>` is an arithmetic shift spelled
 * portably — no C UB/implementation-defined shifts) and the result
 * returns to f64: `>>>` as Uint32, everything else as Int32.
 * ToUint32 and the bitwise operations live in scr_number.c. */
uint32_t scr_to_uint32(double d);
double scr_bit_and(double a, double b);
double scr_bit_or(double a, double b);
double scr_bit_xor(double a, double b);
double scr_bit_shl(double a, double b);
double scr_bit_shr(double a, double b);
double scr_bit_ushr(double a, double b);
double scr_bit_not(double a);

#endif /* SCR_NUMBER_H */
