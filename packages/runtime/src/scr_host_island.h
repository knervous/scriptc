/* The host island: the scr_jsval_* ABI (scr_runtime.h) answered by the embedding application instead of an embedded
 * JavaScript engine. A natively compiled program's page operations (document, timers, console, the GPU, the core) reach
 * the host's own implementations through one vtable; no JS engine is linked.
 *
 * Values crossing the boundary are ScrHostVal: primitives by value, strings as borrowed UTF-8 spans, host objects as
 * 64-bit references the host owns (retain/release), and compiled functions as closure references the host calls back
 * through scr_host_closure_call. Every vtable call returns SCR_HOST_OK, or SCR_HOST_THREW with `out` holding the thrown
 * message (a string) or value; the island turns a throw into the program's catchable TypeError. */
#ifndef SCR_HOST_ISLAND_H
#define SCR_HOST_ISLAND_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef uint64_t ScrHostRef;

enum {
  SCR_HV_UNDEFINED = 0,
  SCR_HV_NULL = 1,
  SCR_HV_BOOL = 2,
  SCR_HV_NUMBER = 3,
  SCR_HV_STRING = 4,
  SCR_HV_OBJECT = 5,   /* a host object or host function: ref */
  SCR_HV_CLOSURE = 6,  /* a compiled function: ref is its closure id (scr_host_closure_*) */
  SCR_HV_PROGRAM = 7,  /* a compiled value held by reference (a class instance): opaque to the host, which retains
                          and releases it like a closure (scr_host_closure_*); the same value when it comes back */
};

typedef struct ScrHostVal {
  uint32_t kind;
  uint32_t flag;      /* SCR_HV_BOOL: 0/1 */
  double number;      /* SCR_HV_NUMBER */
  const char *str;    /* SCR_HV_STRING: UTF-8, borrowed (valid until the next call into the other side) */
  size_t len;
  ScrHostRef ref;     /* SCR_HV_OBJECT / SCR_HV_CLOSURE */
} ScrHostVal;

enum { SCR_HOST_OK = 0, SCR_HOST_THREW = 1 };

/* A host promise's settlement delivered to a native subscriber (promise_subscribe): once, on a later turn of the
 * program's event loop; `value` is borrowed for the call. */
typedef void (*ScrHostSettled)(void *ctx, int rejected, const ScrHostVal *value);

typedef struct ScrHostOps {
  uint32_t abi; /* SCR_HOST_ABI */
  int (*global_get)(const char *name, size_t len, ScrHostVal *out);
  int (*get_prop)(ScrHostRef obj, const char *name, size_t len, ScrHostVal *out);
  int (*set_prop)(ScrHostRef obj, const char *name, size_t len, const ScrHostVal *value, ScrHostVal *out);
  /* this_ref 0 = undefined receiver. */
  int (*call)(ScrHostRef fn, ScrHostRef this_ref, int argc, const ScrHostVal *argv, ScrHostVal *out);
  int (*call_method)(ScrHostRef obj, const char *name, size_t len, int argc, const ScrHostVal *argv, ScrHostVal *out);
  int (*construct)(ScrHostRef ctor, int argc, const ScrHostVal *argv, ScrHostVal *out);
  /* 1 when obj is an instance of ctor. */
  int (*instance_of)(ScrHostRef obj, ScrHostRef ctor);
  /* 1 for a callable host object ("function"), 0 for an object ("object"). */
  int (*is_callable)(ScrHostRef obj);
  void (*retain)(ScrHostRef obj);
  void (*release)(ScrHostRef obj);
  /* The event loop's io hooks (scr_loop_set_io): work the host has ready (due timers, input), and one turn of it,
   * sleeping at most max_wait_ms when nothing is ready. */
  bool (*io_pending)(void);
  void (*io_poll)(double max_wait_ms);

  /* ── ABI 2 (append-only from here) ── */

  /* Plain values the program builds (object and array literals, JSON, checked-dynamic data): a fresh `{}`, and an
   * array of argc values (+1 each). */
  int (*new_object)(ScrHostVal *out);
  int (*new_array)(int argc, const ScrHostVal *argv, ScrHostVal *out);
  /* Array.isArray. */
  int (*is_array)(ScrHostRef obj);
  /* Object.keys(obj) as a fresh host array of strings, in JavaScript's own-key order. */
  int (*own_keys)(ScrHostRef obj, ScrHostVal *out);
  /* Object.hasOwn(obj, name): 0/1. */
  int (*has_own)(ScrHostRef obj, const char *name, size_t len);
  /* An object literal's `get name() {...}`: an enumerable, configurable accessor calling `getter` (a closure or a
   * callable host object) with obj as its receiver. */
  int (*define_getter)(ScrHostRef obj, const char *name, size_t len, const ScrHostVal *getter, ScrHostVal *out);
  /* GetIterator(obj): a host iterator whose next() answers fresh `{ value, done }` objects. Throws for a
   * non-iterable. */
  int (*get_iterator)(ScrHostRef obj, ScrHostVal *out);
  /* A typed array of element kind `elem` (ScrBytesElem numbering: 0 u8, 1 u32, 2 f32, 3 i32, 4 f64, 5 i8, 6 u16,
   * 7 i16, 8 u8 clamped) holding a copy of byte_len bytes. */
  int (*new_bytes)(uint32_t elem, const uint8_t *data, size_t byte_len, ScrHostVal *out);
  /* A typed array's kind and storage, borrowed until the next call into the host: 1 when obj is one, else 0. */
  int (*bytes_view)(ScrHostRef obj, uint32_t *elem, const uint8_t **data, size_t *byte_len);
  /* A fresh Error object named `name` ("TypeError", ...) with `message`. */
  int (*new_error)(const char *name, size_t name_len, const char *message, size_t message_len, ScrHostVal *out);
  /* A pending host promise, and its settlement (the first one wins; a promise value adopts its state). The host runs
   * the reactions (then/catch/finally, subscribers) on later turns of the event loop. */
  int (*new_promise)(ScrHostVal *out);
  void (*settle_promise)(ScrHostRef promise, int rejected, const ScrHostVal *value);
  /* Subscribe `settled` to a host promise: 1, or 0 when obj is not a promise. */
  int (*promise_subscribe)(ScrHostRef obj, ScrHostSettled settled, void *ctx);
  /* A function of a typed host module (`import { fetchBytes } from "host:fetch"`), called with argc values. */
  int (*module_call)(const char *module, size_t module_len, const char *name, size_t name_len, int argc,
                     const ScrHostVal *argv, ScrHostVal *out);
  /* An internal-brand test the checked-dynamic tree narrows with (util.types: "isUint8Array", "isPromise",
   * "isNativeError", ...): 0/1, never a property access. */
  int (*type_probe)(ScrHostRef obj, const char *probe, size_t len);
  /* A host value as console.log renders it (util.inspect's shape: `{ a: 1 }`, `[ 1, 2 ]`): a string. */
  int (*inspect)(ScrHostRef obj, ScrHostVal *out);

  /* ── ABI 3 ── */

  /* A compiled typed array crossing in: new_bytes's copy, plus the compiled array's own storage (`data`, byte_len
   * bytes) for a host function that writes its caller's array in place, as a page function writes a typed array it was
   * handed (a frame block refilled each frame, a batch's answers). `owner` holds that storage: the host takes it +1 and
   * gives it back with scr_host_bytes_release when it drops the value. */
  int (*new_bytes_owned)(uint32_t elem, const uint8_t *data, size_t byte_len, uint8_t *storage, void *owner,
                         ScrHostVal *out);
} ScrHostOps;

#define SCR_HOST_ABI 3

/* Provided by the embedding application (link time): its vtable, asked for once on the island's first use. */
const ScrHostOps *scr_host_ops(void);

/* Provided by the runtime for the host: call a compiled function the program handed over (a SCR_HV_CLOSURE ref) with
 * argc values; *out receives the result (a string result stays valid until the next call into the program). Returns
 * SCR_HOST_THREW when the function threw: the exception stays pending in the program (the loop reports it as an
 * uncaught callback error) unless the host takes it (scr_host_take_exception). */
int scr_host_closure_call(ScrHostRef closure, int argc, const ScrHostVal *argv, ScrHostVal *out);
void scr_host_closure_retain(ScrHostRef closure);
void scr_host_closure_release(ScrHostRef closure);
/* ABI 2: the exception a callback left pending (after scr_host_closure_call answered SCR_HOST_THREW), moved out to the
 * host as a value it owns (an Error object for the program's errors, else the thrown primitive) — a promise reaction
 * rejects its derived promise with it. 0 when nothing is pending. A string stays valid until the next call. */
int scr_host_take_exception(ScrHostVal *out);
/* The host reports that an object it handed out is gone (its last count released; the ref may name another object
 * next): weak collections drop the entries keyed on it. */
void scr_host_object_disposed(ScrHostRef obj);
/* ABI 3: gives back the `owner` new_bytes_owned handed over (the compiled typed array's storage may go with it). */
void scr_host_bytes_release(void *owner);

#ifdef __cplusplus
}
#endif

#endif
