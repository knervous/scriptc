/* scriptc runtime — the native-dyn browser forms of the LLVM lane (scr_dyn_native.c, scr_dyn_native_symbol.c): the
 * WasmGC browser frontend's native dyn model compiled natively against the host island, with no JS engine. The
 * compiler declares these itself; the units include this header to keep their definitions in step. */
#ifndef SCR_DYN_NATIVE_H
#define SCR_DYN_NATIVE_H

#include "scr_runtime.h"

ScrDyn *scr_dyn_native_ctor_cached(const char *id, size_t id_len);
ScrDyn *scr_dyn_native_ctor_store(const char *id, size_t id_len, ScrDyn *value);
void scr_dyn_native_define_hidden(ScrDyn *target, ScrDyn *key, ScrDyn *value, bool fixed);
ScrDyn *scr_dyn_native_array_ctor_value(ScrDyn *is_array, ScrDyn *from, ScrDyn *of);
ScrDyn *scr_dyn_native_object_ctor_value(ScrDyn *names, ScrDyn *values);
ScrDyn *scr_dyn_native_ctor_statics(ScrDyn *ctor, ScrDyn *names, ScrDyn *values, const char *id, size_t id_len);
ScrDyn *scr_dyn_native_symbol_ctor_value(ScrDyn *call, ScrDyn *for_fn, ScrDyn *key_for);
ScrDyn *scr_dyn_native_builtin_function(const char *id, size_t id_len);
bool scr_dyn_native_instance_of_global(const ScrDyn *value, const char *name, size_t len);

/* ── frozen records (record.freeze / record.inherit) ──────────────────────
 * Upstream scriptc's design on this runtime's rc word: a record a program may freeze (llvm/frozen-records.ts) keeps
 * SCR_RECORD_FROZEN beside its count, its emitted release counts without the bit, and every write to it tests the
 * bit first. A count never reaches the bit; an immortal record (rc SIZE_MAX, every bit set) is never frozen, and its
 * word does not read as frozen. Records keep their layout. */
#if SIZE_MAX > UINT32_MAX
#define SCR_RECORD_FROZEN ((size_t)1 << 62)
#else
#define SCR_RECORD_FROZEN ((size_t)1 << 30)
#endif

static inline bool scr_record_frozen_word(const void *record) {
  size_t rc = *(const size_t *)record;
  return rc != SIZE_MAX && (rc & SCR_RECORD_FROZEN) != 0;
}

bool scr_record_is_frozen(const void *record);
void scr_record_inherit(void *copy, const void *source);
void scr_record_freeze_view(const void *record, ScrDyn *view);
ScrDyn *scr_dyn_freeze_record(ScrDyn *value);

bool scr_dyn_native_index_test(const ScrDyn *value, double index, int test);
ScrDyn *scr_dyn_native_array_index_get(const ScrDyn *array, double index);
void scr_dyn_native_array_index_set(ScrDyn *array, double index, ScrDyn *value);

ScrDyn *scr_dyn_native_collection_new(const char *kind, const ScrDyn *seed);

bool scr_dyn_native_needs_open(const ScrDyn *value);

ScrDyn *scr_dyn_native_opened(const ScrDyn *iterator);

ScrStr *scr_dyn_native_regex_replace_fn(ScrStr *subject, ScrRegex *re, ScrDyn *fn, bool all);

#endif
