/* scriptc runtime — the two native-dyn iteration probes a static program reaches too: the LLVM lowering of
 * untyped array destructuring and of `new Map(untyped)` / `new Set(untyped)` (the frontend's openedIterable) asks
 * dyn.needsOpen and dyn.opened whatever the program's dyn model, so they live in a base unit rather than in
 * scr_dyn_native.c, which only host-island programs link. Both use base units alone (scr_error.c). */
#include "scr_dyn_native.h"
#include <string.h>

/* Whether a native consumer (new Map / new Set, array destructuring) must open an untyped source through the class
 * dispatch first (dyn.needsOpen): a compiled class instance (its own [Symbol.iterator] is a compiled method the
 * dispatch finds); arrays, plain objects, collections, generators, typed arrays and strings are opened by the
 * consumer itself. */
bool scr_dyn_native_needs_open(const ScrDyn *value) {
  return value && value->kind == SCR_DYN_TYPED_REF && value->v.typed_ref.type_key_len >= 7 &&
         memcmp(value->v.typed_ref.type_key, "object:", 7) == 0;
}

/* dyn.opened: the iterator a class instance's own [Symbol.iterator] returned, standing as an iterable for a native
 * consumer. LLVM's consumers (destructuring's dynIterN, new Map / new Set / WeakMap seeds) take arrays, strings,
 * typed arrays, typed capsules and host values, not a stepped iterator object, so this refuses loudly (a catchable
 * SC2020 Error) rather than read the iterator wrongly. NULL with the error pending. */
ScrDyn *scr_dyn_native_opened(const ScrDyn *iterator) {
  (void)iterator;
  static const char message[] = "a class instance iterated by a native consumer (array destructuring, new Map / new Set) has no LLVM lowering yet";
  scr_throw_error_msg_code(SCR_ERR_ERROR, message, sizeof message - 1, "SC2020");
  return NULL;
}
