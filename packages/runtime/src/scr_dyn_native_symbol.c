/* scriptc runtime — the native host's `Symbol` read as a value (dyn.symbolConstructorValue; scr_dyn_native.c has the
 * other constructor values). Its own unit so symbol-free programs keep the symbol unit (scr_symbol.c) out of their
 * link. Built once from the frontend's closures: the call closure (Symbol(description); `new Symbol` is refused, the
 * closure is no constructor) carrying `for`, `keyFor`, the well-known symbols, and a `prototype` holding
 * `constructor` and Symbol.toStringTag "Symbol". Arguments are borrowed. */
#include "scr_dyn_native.h"

#include <string.h>

static ScrDyn *scr_native_symbol_key(const char *name) {
  ScrStr *text = scr_str_new(name, strlen(name));
  ScrSym *symbol = scr_sym_well_known(text);
  scr_str_release(text);
  ScrDyn *key = scr_dyn_new_symbol(symbol);
  scr_sym_release(symbol);
  return key;
}

static ScrDyn *scr_native_string_key(const char *name) {
  ScrStr *text = scr_str_new(name, strlen(name));
  ScrDyn *key = scr_dyn_new_str(text);
  scr_str_release(text);
  return key;
}

static void scr_native_define(ScrDyn *target, ScrDyn *key /*moves*/, ScrDyn *value /*moves*/, bool fixed) {
  scr_dyn_native_define_hidden(target, key, value, fixed);
  scr_dyn_release(key);
  scr_dyn_release(value);
}

ScrDyn *scr_dyn_native_symbol_ctor_value(ScrDyn *call, ScrDyn *for_fn, ScrDyn *key_for) {
  static const char *const well_known[] = { "asyncIterator", "hasInstance", "isConcatSpreadable", "iterator", "match",
    "matchAll", "replace", "search", "species", "split", "toPrimitive", "toStringTag", "unscopables" };
  scr_native_define(call, scr_native_string_key("for"), scr_dyn_retain(for_fn), false);
  scr_native_define(call, scr_native_string_key("keyFor"), scr_dyn_retain(key_for), false);
  ScrDyn *prototype = scr_dyn_new_obj();
  scr_native_define(prototype, scr_native_string_key("constructor"), scr_dyn_retain(call), false);
  ScrStr *tag = scr_str_new("Symbol", 6);
  ScrDyn *tag_value = scr_dyn_new_str(tag);
  scr_str_release(tag);
  /* Symbol.prototype[Symbol.toStringTag]: non-writable, configurable. */
  ScrDyn *descriptor = scr_dyn_new_obj();
  scr_dyn_obj_set(descriptor, "value", 5, tag_value);
  scr_dyn_obj_set(descriptor, "writable", 8, scr_dyn_new_bool(false));
  scr_dyn_obj_set(descriptor, "enumerable", 10, scr_dyn_new_bool(false));
  scr_dyn_obj_set(descriptor, "configurable", 12, scr_dyn_new_bool(true));
  ScrDyn *tag_key = scr_native_symbol_key("toStringTag");
  scr_dyn_release(scr_dyn_define_property(prototype, tag_key, descriptor));
  scr_dyn_release(tag_key);
  scr_dyn_release(descriptor);
  scr_native_define(call, scr_native_string_key("prototype"), prototype, true);
  for (size_t i = 0; i < sizeof well_known / sizeof well_known[0] && !scr_exc_pending(); i++)
    scr_native_define(call, scr_native_string_key(well_known[i]), scr_native_symbol_key(well_known[i]), true);
  return scr_dyn_native_ctor_store("Symbol", 6, call);
}
