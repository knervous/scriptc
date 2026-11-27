/* scriptc runtime — weak stand-ins, in COFF packs only, for functions of optional units that a linked unit calls only
 * from functions no program reaches without the other unit. lld-link reports the undefined symbols of every object it
 * links, also those that only unreached functions refer to; the ELF and Mach-O links of the same objects drop those
 * functions with their sections, so this unit is in COFF packs alone (runtime-pack-matrix.mjs COFF_BASE_SOURCES).
 * Linking the defining units instead would run their constructors in programs that do not select them:
 * scr_dyn_invoke.c installs the global-constructor and inherited-member hooks that scr_json.c reads, and
 * scr_async_dyn.c the DEP0203 hook, so a Windows program would answer differently from the same program elsewhere.
 * Each stand-in is weak: the defining unit's own definition replaces it whenever the program selects that unit.
 * Reaching one means a program needed a unit its features did not select; it traps, naming the function and the
 * unit. The parameters are the declarations' own (scr_runtime.h), unused. */
#ifdef _WIN32

#include "scr_runtime.h"

#define SCR_COFF_UNLINKED(fn, unit) scr_trap("scriptc: " fn " was reached, but " unit " is not linked\n")

/* scr_event_target.c: the events.on iterator (scr_eon_*) invokes its emitter's methods through scr_dyn_invoke.c and
 * answers its promises through scr_async_dyn.c, and util.aborted (scr_util_aborted) answers a checked-dynamic
 * promise; programs that call either select both units (dynInvoke, dynAsync). */
__attribute__((weak)) ScrDyn *scr_dyn_invoke(ScrDyn *recv, const char *method, ScrDyn *const *args, size_t argc,
                                             const char *what) {
  SCR_COFF_UNLINKED("scr_dyn_invoke", "scr_dyn_invoke.c");
}
__attribute__((weak)) ScrDyn *scr_dyn_new_promise(ScrPromise *p) {
  SCR_COFF_UNLINKED("scr_dyn_new_promise", "scr_async_dyn.c");
}
__attribute__((weak)) void scr_promise_resolve_dyn(ScrPromise *destination, ScrDyn *value) {
  SCR_COFF_UNLINKED("scr_promise_resolve_dyn", "scr_async_dyn.c");
}

/* scr_stream.c: the readline interfaces over a stream (scr_stream_rl_*: createInterface with a stream input or
 * output, readline/promises' Readline), reached only by readline calls, which select scr_readline.c (events);
 * emitKeypressEvents on a stream, which selects scr_readline_tty.c too (events, regex); and Readable.from over an
 * untyped iterable (scr_from_dyn_ex), whose programs select scr_stream_ops.c (stream, dynAsync). */
__attribute__((weak)) double scr_rl_open(const ScrRlIo *io, void *in, void *out, bool out_stdout, double crlf_delay,
                                         ScrStr *prompt, ScrDyn *signal, ScrAbortAddFn add) {
  SCR_COFF_UNLINKED("scr_rl_open", "scr_readline.c");
}
__attribute__((weak)) void scr_rl_input_bytes(double id, ScrBytes *chunk) {
  SCR_COFF_UNLINKED("scr_rl_input_bytes", "scr_readline.c");
}
__attribute__((weak)) void scr_rl_input_str(double id, ScrStr *chunk) {
  SCR_COFF_UNLINKED("scr_rl_input_str", "scr_readline.c");
}
__attribute__((weak)) void scr_rl_input_end(double id) {
  SCR_COFF_UNLINKED("scr_rl_input_end", "scr_readline.c");
}
__attribute__((weak)) void scr_rl_input_error(double id, ScrError *err) {
  SCR_COFF_UNLINKED("scr_rl_input_error", "scr_readline.c");
}
__attribute__((weak)) double scr_rl_ui_open(const ScrRlIo *io, void *out, double fd, bool auto_commit) {
  SCR_COFF_UNLINKED("scr_rl_ui_open", "scr_readline.c");
}
__attribute__((weak)) void scr_rl_keypress_events(const ScrRlIo *io, void *stream, double iface, double timeout) {
  SCR_COFF_UNLINKED("scr_rl_keypress_events", "scr_readline_tty.c");
}
__attribute__((weak)) ScrStream *scr_stream_from_dyn_iter(ScrDyn *iter, bool async_iter, double flags, double hwm) {
  SCR_COFF_UNLINKED("scr_stream_from_dyn_iter", "scr_stream_ops.c");
}

/* scr_events.c: process.finalization's ExperimentalWarnings (scr_fin_warn), reached only by programs that call
 * process.finalization, which select scr_async_dyn.c (dynAsync) for its deferred warning queue. */
__attribute__((weak)) ScrDyn *scr_warning_new(ScrStr *message, const char *type, const ScrStr *code) {
  SCR_COFF_UNLINKED("scr_warning_new", "scr_async_dyn.c");
}
__attribute__((weak)) void scr_warning_emit_deferred(ScrDyn *warning) {
  SCR_COFF_UNLINKED("scr_warning_emit_deferred", "scr_async_dyn.c");
}

/* scr_dyn_native_symbol.c (the host island's `Symbol` value): the well-known symbol keys of scr_native_symbol_key,
 * reached only when a program reads `Symbol` as a value, whose closures (sym.new, sym.for, sym.keyFor) select
 * scr_symbol.c (symbol). */
__attribute__((weak)) ScrSym *scr_sym_well_known(ScrStr *name) {
  SCR_COFF_UNLINKED("scr_sym_well_known", "scr_symbol.c");
}
__attribute__((weak)) ScrDyn *scr_dyn_new_symbol(ScrSym *value) {
  SCR_COFF_UNLINKED("scr_dyn_new_symbol", "scr_symbol.c");
}
__attribute__((weak)) void scr_sym_release(ScrSym *s) {
  SCR_COFF_UNLINKED("scr_sym_release", "scr_symbol.c");
}

#endif
