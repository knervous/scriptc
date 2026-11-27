/* The Atomics helpers scr_lib.c (the operations) and scr_atomics_wait.c (wait, notify, waitAsync) share. */
#ifndef SCR_ATOMICS_PRIVATE_H
#define SCR_ATOMICS_PRIVATE_H

#include "scr_runtime.h"
#include <math.h>

/* ValidateAtomicAccess: the element's address, or NULL with a RangeError
 * pending. ToIndex: NaN is 0, fractions truncate, negative or past the end
 * throws. */
static inline uint8_t *scr_atomics_addr(ScrBytes *arr, double idx) {
  double i = idx != idx ? 0 : trunc(idx);
  if (!(i >= 0 && i < (double)arr->len)) {
    scr_throw_error_msg(SCR_ERR_RANGE, "Invalid atomic access index", 27);
    return NULL;
  }
  return arr->data + (size_t)i * scr_bytes_elem_size(arr->elem);
}

/* ToIntegerOrInfinity then modulo 2^32 (the element conversions narrow from
 * this; NaN and infinities are 0). */
static inline uint32_t scr_atomics_u32(double v) {
  if (v != v || isinf(v)) return 0;
  double t = fmod(trunc(v), 4294967296.0);
  if (t < 0) t += 4294967296.0;
  return (uint32_t)t;
}

/* The element's value as a JS number. */
static inline double scr_atomics_number(ScrBytesElem elem, uint32_t bits) {
  switch (elem) {
    case SCR_BYTES_I8: return (double)(int8_t)bits;
    case SCR_BYTES_U8: return (double)(uint8_t)bits;
    case SCR_BYTES_I16: return (double)(int16_t)bits;
    case SCR_BYTES_U16: return (double)(uint16_t)bits;
    case SCR_BYTES_I32: return (double)(int32_t)bits;
    default: return (double)bits;
  }
}

/* The integer typed array an untyped Atomics argument holds, or NULL with Node's TypeError pending (scr_shared.c). */
ScrBytes *scr_atomics_dyn_array(const ScrDyn *value, bool waitable);

#endif
