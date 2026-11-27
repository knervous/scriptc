/* scriptc runtime — the native-dyn browser forms of the LLVM lane (the native host island: a program compiled
 * natively with the WasmGC browser frontend's native dyn model and no JS engine). WasmGC lowers these forms onto its
 * own dyn structs; here they are ordinary ScrDyn values.
 *
 * Builtin constructor values (dyn.arrayConstructorValue, dyn.objectConstructorValue, dyn.constructorStatics): what
 * `Array`, `Object`, `Number`, `String`, `Function` answer when read as values on the native host. Each is built once,
 * from the frontend's closures, and keeps one identity for the program's life: the Array value is the runtime's own
 * Array constructor (scr_dyn_array_constructor), so instanceof, construction and `x.constructor` agree with it.
 * Statics are non-enumerable; function statics are writable and configurable and the rest (Number.MAX_VALUE, a
 * constructor's `prototype`) are neither, as in JavaScript. Arguments are borrowed. */
#include "scr_dyn_native.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* The built values by id ("Array", "Object", "Symbol", or a constructorStatics id). Each entry owns one reference
 * until runtime cleanup. */
#define SCR_NATIVE_CTOR_MAX 16
static SCR_TL struct { const char *id; size_t id_len; ScrDyn *value; } scr_native_ctors[SCR_NATIVE_CTOR_MAX];
static SCR_TL size_t scr_native_ctor_count;

static void scr_native_ctors_cleanup(void) {
  for (size_t i = 0; i < scr_native_ctor_count; i++) {
    ScrDyn *value = scr_native_ctors[i].value;
    scr_native_ctors[i].value = NULL;
    scr_dyn_release(value);
  }
  scr_native_ctor_count = 0;
}

/* +1, or NULL before the value with this id is built. */
ScrDyn *scr_dyn_native_ctor_cached(const char *id, size_t id_len) {
  for (size_t i = 0; i < scr_native_ctor_count; i++)
    if (scr_native_ctors[i].id_len == id_len && memcmp(scr_native_ctors[i].id, id, id_len) == 0)
      return scr_dyn_retain(scr_native_ctors[i].value);
  return NULL;
}

/* Keeps `value` (borrowed; retained) under `id`, a static literal, and answers it +1. */
ScrDyn *scr_dyn_native_ctor_store(const char *id, size_t id_len, ScrDyn *value) {
  if (scr_native_ctor_count == SCR_NATIVE_CTOR_MAX) scr_trap("scriptc: too many native constructor values\n");
  if (scr_native_ctor_count == 0) scr_atexit(scr_native_ctors_cleanup);
  scr_native_ctors[scr_native_ctor_count].id = id;
  scr_native_ctors[scr_native_ctor_count].id_len = id_len;
  scr_native_ctors[scr_native_ctor_count].value = scr_dyn_retain(value);
  scr_native_ctor_count++;
  return scr_dyn_retain(value);
}

/* Defines the non-enumerable data property `key` of `target` (a function or object): `value` borrowed. */
void scr_dyn_native_define_hidden(ScrDyn *target, ScrDyn *key, ScrDyn *value, bool fixed) {
  ScrDyn *descriptor = scr_dyn_new_obj();
  scr_dyn_obj_set(descriptor, "value", 5, scr_dyn_retain(value));
  scr_dyn_obj_set(descriptor, "writable", 8, scr_dyn_new_bool(!fixed));
  scr_dyn_obj_set(descriptor, "enumerable", 10, scr_dyn_new_bool(false));
  scr_dyn_obj_set(descriptor, "configurable", 12, scr_dyn_new_bool(!fixed));
  scr_dyn_release(scr_dyn_define_property(target, key, descriptor));
  scr_dyn_release(descriptor);
}

static void scr_native_hidden(ScrDyn *target, const char *key, ScrDyn *value, bool fixed) {
  ScrStr *name = scr_str_new(key, strlen(key));
  ScrDyn *property = scr_dyn_new_str(name);
  scr_str_release(name);
  scr_dyn_native_define_hidden(target, property, value, fixed);
  scr_dyn_release(property);
}

/* Parallel dyn arrays of names (strings) and values: functions writable and configurable, the rest fixed. */
static void scr_native_statics(ScrDyn *target, const ScrDyn *names, const ScrDyn *values) {
  if (names->kind != SCR_DYN_ARR || values->kind != SCR_DYN_ARR || names->v.arr.len != values->v.arr.len)
    scr_trap("scriptc: native constructor statics are not parallel arrays\n");
  for (size_t i = 0; i < names->v.arr.len && !scr_exc_pending(); i++) {
    ScrDyn *value = values->v.arr.items[i];
    scr_dyn_native_define_hidden(target, names->v.arr.items[i], value, value->kind != SCR_DYN_FUNC);
  }
}

ScrDyn *scr_dyn_native_array_ctor_value(ScrDyn *is_array, ScrDyn *from, ScrDyn *of) {
  ScrDyn *ctor = scr_dyn_array_constructor();
  scr_native_hidden(ctor, "isArray", is_array, false);
  scr_native_hidden(ctor, "from", from, false);
  scr_native_hidden(ctor, "of", of, false);
  ScrDyn *prototype = scr_dyn_array_prototype();
  scr_native_hidden(ctor, "prototype", prototype, true);
  scr_dyn_release(prototype);
  ScrDyn *out = scr_dyn_native_ctor_store("Array", 5, ctor);
  scr_dyn_release(ctor);
  return out;
}

/* Object(value) and new Object(value): a fresh object for nullish (or no) input, the object itself otherwise. The
 * native host has no primitive wrapper objects, so a primitive is refused as on the WasmGC native host. */
static ScrDyn *scr_native_object_call(ScrClosure *closure, ScrDyn *const *args, size_t argc) {
  (void)closure;
  const ScrDyn *value = argc > 0 ? args[0] : NULL;
  if (!value || value->kind == SCR_DYN_UNDEF || value->kind == SCR_DYN_NULL) return scr_dyn_new_obj();
  switch (value->kind) {
  case SCR_DYN_BOOL: case SCR_DYN_NUM: case SCR_DYN_STR: case SCR_DYN_BIGINT: case SCR_DYN_SYMBOL: {
    static const char message[] = "Object(primitive) boxing is not supported on compiled values yet";
    scr_throw_error_msg(SCR_ERR_TYPE, message, sizeof message - 1);
    return NULL;
  }
  default: return scr_dyn_retain((ScrDyn *)value);
  }
}

ScrDyn *scr_dyn_native_object_ctor_value(ScrDyn *names, ScrDyn *values) {
  ScrClosure *closure = scr_closure_new(NULL, 0);
  /* An ordinary constructor: `new` creates the receiver from `prototype` and keeps the call's object result. */
  closure->function_kind = 4;
  ScrDyn *ctor = scr_dyn_new_func(closure, scr_native_object_call, 1, "native:Object", "Object");
  scr_native_statics(ctor, names, values);
  ScrDyn *prototype = scr_dyn_object_prototype();
  scr_native_hidden(ctor, "prototype", prototype, true);
  scr_dyn_release(prototype);
  ScrDyn *out = scr_dyn_native_ctor_store("Object", 6, ctor);
  scr_dyn_release(ctor);
  return out;
}

/* A constructor value carrying statics (String, Number, Function), built once per id (a static literal). The
 * native host keeps no Function.prototype object (functions inherit nothing reflectable here), so Function's value
 * carries no `prototype`. */
ScrDyn *scr_dyn_native_ctor_statics(ScrDyn *ctor, ScrDyn *names, ScrDyn *values, const char *id, size_t id_len) {
  scr_native_statics(ctor, names, values);
  return scr_dyn_native_ctor_store(id, id_len, ctor);
}

/* Object.is as a value (dyn.builtinFunction): SameValue over its first two arguments (missing ones are undefined). */
static ScrDyn *scr_native_object_is(ScrClosure *closure, ScrDyn *const *args, size_t argc) {
  (void)closure;
  const ScrDyn *left = argc > 0 ? args[0] : scr_dyn_undefined();
  const ScrDyn *right = argc > 1 ? args[1] : scr_dyn_undefined();
  return scr_dyn_new_bool(scr_dyn_same_value(left, right));
}

/* A standard-library function taken as a value (dyn.builtinFunction; the compiler admits "Object.is" only): one
 * compiled function for the program's life, +1. */
ScrDyn *scr_dyn_native_builtin_function(const char *id, size_t id_len) {
  ScrDyn *cached = scr_dyn_native_ctor_cached(id, id_len);
  if (cached) return cached;
  if (id_len != 9 || memcmp(id, "Object.is", 9) != 0) scr_trap("scriptc: unknown native builtin function\n");
  ScrDyn *fn = scr_dyn_new_func(scr_closure_new(NULL, 0), scr_native_object_is, 2, "native:Object.is", "is");
  ScrDyn *out = scr_dyn_native_ctor_store(id, id_len, fn);
  scr_dyn_release(fn);
  return out;
}

/* Whether an ordinary object's prototype chain reaches Object.prototype (Object.create(null) and objects built on
 * one do not). Arrays and functions on the chain inherit from Object.prototype themselves. */
static bool scr_native_inherits_object(const ScrDyn *value) {
  ScrDyn *object_prototype = scr_dyn_object_prototype();
  bool result = false;
  for (const ScrDyn *current = value; current; current = current->prototype) {
    if (current == object_prototype) { result = current != value; break; }
    if (current->kind != SCR_DYN_OBJ) { result = true; break; }
    if (!current->prototype) { result = !current->null_proto; break; }
  }
  scr_dyn_release(object_prototype);
  return result;
}

static bool scr_native_name_is(const char *name, size_t len, const char *literal) {
  return len == strlen(literal) && memcmp(name, literal, len) == 0;
}

/* `value instanceof G` for a builtin constructor global G (dyn.instanceOfGlobal): compiled values answer by their
 * kind. A host value (JSVAL, the native host island's page objects) is an Object, a Function when the host says it is
 * callable and an Array when the host says so; the host holds no Map, Set, Date, RegExp or Promise of its own, and
 * the page-brand constructors (Number, String, Boolean, Symbol, BigInt, WeakRef, ...) have no instances among
 * compiled values. */
bool scr_dyn_native_instance_of_global(const ScrDyn *value, const char *name, size_t len) {
  if (!value) return false;
  ScrDynKind kind = value->kind;
  if (kind == SCR_DYN_NULL || kind == SCR_DYN_UNDEF || kind == SCR_DYN_BOOL || kind == SCR_DYN_NUM ||
      kind == SCR_DYN_STR || kind == SCR_DYN_BIGINT || kind == SCR_DYN_SYMBOL)
    return false;
  if (scr_native_name_is(name, len, "Object")) return kind == SCR_DYN_OBJ ? scr_native_inherits_object(value) : true;
  if (scr_native_name_is(name, len, "Function"))
    return kind == SCR_DYN_FUNC || (kind == SCR_DYN_JSVAL && scr_dyn_isl_typeof_is(value, "function"));
  if (scr_native_name_is(name, len, "Array")) return kind == SCR_DYN_ARR || (kind == SCR_DYN_JSVAL && scr_dyn_isl_is_array(value));
  if (scr_native_name_is(name, len, "Promise")) return kind == SCR_DYN_PROMISE;
  if (kind != SCR_DYN_HANDLE) return false;
  ScrDynHandleTag tag = value->v.handle.tag;
  if (scr_native_name_is(name, len, "Map")) return tag == SCR_DYNH_MAP;
  if (scr_native_name_is(name, len, "Set")) return tag == SCR_DYNH_SET;
  if (scr_native_name_is(name, len, "WeakMap")) return tag == SCR_DYNH_WEAK_MAP;
  if (scr_native_name_is(name, len, "WeakSet")) return tag == SCR_DYNH_WEAK_SET;
  if (scr_native_name_is(name, len, "Date")) return tag == SCR_DYNH_DATE;
  if (scr_native_name_is(name, len, "RegExp")) return tag == SCR_DYNH_REGEXP;
  return false;
}

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

static bool scr_record_frozen_word(const void *record) {
  size_t rc = *(const size_t *)record;
  return rc != SIZE_MAX && (rc & SCR_RECORD_FROZEN) != 0;
}

bool scr_record_is_frozen(const void *record) { return scr_record_frozen_word(record); }

/* Object.freeze of a record crossing as an untyped value (the compiler emits it for freezable shapes only): the
 * record's bit through its capsule, then the capsule's view. A value that is no capsule freezes as itself. +1. */
ScrDyn *scr_dyn_freeze_record(ScrDyn *value) {
  if (value->kind != SCR_DYN_TYPED_REF) return scr_dyn_freeze(value);
  scr_record_freeze(value->v.typed_ref.ptr);
  if (value->v.typed_ref.materialized) scr_dyn_release(scr_dyn_freeze(value->v.typed_ref.materialized));
  return scr_dyn_retain(value);
}

/* A width copy of a record keeps its source's integrity level (a frozen record's copy is frozen). */
void scr_record_inherit(void *copy, const void *source) {
  if (scr_record_frozen_word(source)) scr_record_freeze(copy);
}

/* The dyn copy of a frozen record is frozen too (Object.isFrozen, and a write through the untyped value throws
 * before it could commit to the record). Runs before the copy is marked a native snapshot. */
void scr_record_freeze_view(const void *record, ScrDyn *view) {
  if (scr_record_frozen_word(record)) scr_dyn_release(scr_dyn_freeze(view));
}


/* ── numeric keys on compiled dyn values (dyn.isArrayIndex & co) ──────────
 * The class index dispatchers' fast tests: a compiled dyn array with an integer index below its length (a store: at
 * most its length), a typed array with an integer index in i32 range, a string with an integer index below its
 * UTF-16 length. The accessors read and write exactly as the ToString(index) key path does. */
static double scr_dyn_native_utf16_len(const ScrDyn *value) { return scr_str_utf16_len(value->v.str); }

enum { SCR_NATIVE_INDEX_ARRAY = 0, SCR_NATIVE_INDEX_ARRAY_STORE = 1, SCR_NATIVE_INDEX_TYPED = 2, SCR_NATIVE_INDEX_STRING = 3 };

bool scr_dyn_native_index_test(const ScrDyn *value, double index, int test) {
  if (!value || !(index >= 0) || floor(index) != index) return false;
  switch (test) {
  case SCR_NATIVE_INDEX_ARRAY: return value->kind == SCR_DYN_ARR && index < (double)value->v.arr.len;
  case SCR_NATIVE_INDEX_ARRAY_STORE: return value->kind == SCR_DYN_ARR && index <= (double)value->v.arr.len;
  case SCR_NATIVE_INDEX_TYPED: return value->kind == SCR_DYN_BYTES && index < 2147483648.0;
  case SCR_NATIVE_INDEX_STRING: return value->kind == SCR_DYN_STR && index < scr_dyn_native_utf16_len(value);
  default: return false;
  }
}

/* arr[index] of a compiled dyn array (the test passed): the element, a hole or past the end reading as the key
 * path does. +1. */
ScrDyn *scr_dyn_native_array_index_get(const ScrDyn *array, double index) {
  if (!array || array->kind != SCR_DYN_ARR) scr_trap("scriptc: dyn.arrayIndexGet of a non-array\n");
  return scr_dyn_arr_at(array, index);
}

/* arr[index] = value through the ToString(index) key write (growth, holes, frozen and sealed arrays). Borrows. */
void scr_dyn_native_array_index_set(ScrDyn *array, double index, ScrDyn *value) {
  if (!array || array->kind != SCR_DYN_ARR) scr_trap("scriptc: dyn.arrayIndexSet of a non-array\n");
  char text[32];
  int length = snprintf(text, sizeof text, "%.0f", index);
  ScrStr *key = scr_str_new(text, (size_t)length);
  scr_dyn_key_set(array, key, value);
  scr_str_release(key);
}

/* ── new Map(iterable) / new Set(iterable) on untyped values (dyn.newCollection) ──
 * A compiled native collection (the runtime's Map<unknown, unknown> / Set<unknown> handles), seeded from the source
 * the frontend has opened: undefined and null seed nothing; anything else iterates (a non-iterable throws Node's
 * TypeError there). A Map entry is an object whose "0" and "1" are its key and value. */
static ScrDyn *scr_native_entry_read(const ScrDyn *entry, size_t index) {
  if (entry->kind == SCR_DYN_ARR) return scr_dyn_arr_at(entry, (double)index);
  if (entry->kind == SCR_DYN_TYPED_REF) {
    ScrDyn *view = scr_dyn_typed_ref_materialize(entry);
    if (!view) return NULL;
    ScrDyn *out = scr_native_entry_read(view, index);
    scr_dyn_release(view);
    return out;
  }
  const char key = (char)('0' + index);
  ScrDyn *value = entry->kind == SCR_DYN_OBJ ? scr_dyn_obj_get(entry, &key, 1) : NULL;
  return scr_dyn_retain(value ? value : scr_dyn_undefined());
}

static bool scr_native_is_entry_object(const ScrDyn *entry) {
  return entry->kind == SCR_DYN_ARR || entry->kind == SCR_DYN_OBJ || entry->kind == SCR_DYN_TYPED_REF ||
         entry->kind == SCR_DYN_FUNC || entry->kind == SCR_DYN_HANDLE;
}

/* A Map of dyn keys and values: both sides retained and traced. */
static const ScrMapOps scr_native_map_ops = {
  scr_dyn_retain_v, scr_dyn_release_v, scr_dyn_trace_v,
  scr_dyn_retain_v, scr_dyn_release_v, scr_dyn_trace_v, NULL
};

static ScrDyn *scr_native_map_new(const ScrDyn *seed) {
  ScrDyn *entries = NULL;
  if (seed->kind != SCR_DYN_NULL && seed->kind != SCR_DYN_UNDEF) {
    entries = scr_dyn_iter_pack(seed, NULL);
    if (!entries) return NULL;
  }
  ScrMap *map = scr_map_new(SCR_MAP_KEY_DYN, SCR_MAP_VAL_REF, &scr_native_map_ops);
  for (size_t i = 0; entries && i < entries->v.arr.len && !scr_exc_pending(); i++) {
    const ScrDyn *entry = entries->v.arr.items[i];
    if (!scr_native_is_entry_object(entry)) {
      ScrStr *shown = scr_dyn_display(entry);
      size_t capacity = shown->len + 48;
      char *message = malloc(capacity);
      if (!message) scr_trap("scriptc: out of memory\n");
      int used = snprintf(message, capacity, "Iterator value %.*s is not an entry object", (int)shown->len, shown->data);
      scr_str_release(shown);
      scr_throw_error_msg(SCR_ERR_TYPE, message, (size_t)used);
      free(message);
      break;
    }
    ScrDyn *key = scr_native_entry_read(entry, 0);
    ScrDyn *value = key ? scr_native_entry_read(entry, 1) : NULL;
    if (key && value) scr_map_dyn_set(map, key, value, false);
    scr_dyn_release(key);
    scr_dyn_release(value);
  }
  scr_dyn_release(entries);
  if (scr_exc_pending()) { scr_map_release(map); return NULL; }
  ScrDyn *result = scr_dyn_native_map(map);
  scr_map_release(map);
  return result;
}

/* +1, or NULL with the TypeError pending. `kind` is "Map" or "Set" (the compiler admits only those). */
ScrDyn *scr_dyn_native_collection_new(const char *kind, const ScrDyn *seed) {
  if (strcmp(kind, "Set") == 0) return scr_dyn_native_set_new(seed);
  if (strcmp(kind, "Map") == 0) return scr_native_map_new(seed);
  scr_trap("scriptc: dyn.newCollection of an unknown collection\n");
}

/* dyn.needsOpen and dyn.opened (scr_dyn_native_needs_open, scr_dyn_native_opened) are in scr_dyn_native_open.c, a
 * base unit: static programs reach them too. */
