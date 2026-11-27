/* The host island (scr_host_island.h): the scr_jsval_* ABI over the embedding application's vtable, linked in place of
 * scr_island.c and its engine. Primitives live in the cell; host objects are references the host owns; compiled
 * functions handed to the host are closure-table entries it calls back through scr_host_closure_call.
 *
 * Ownership follows the island ABI: arguments are borrowed, results are fresh +1 cells, NULL means an exception is
 * pending. A reference the host returns in *out is owned by the island (+1); one the island passes in is borrowed (the
 * host retains what it keeps).
 *
 * The reference semantics are scr_island.c's (QuickJS): where that island runs a JavaScript prelude helper, this one
 * spells the same algorithm over the vtable (iteration, spread, JSON, the destructuring guards), with V8's TypeError
 * texts. */
#include "scr_runtime.h"
#include "scr_host_island.h"

#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

struct ScrJsval {
  size_t rc;
  uint32_t kind; /* SCR_HV_* */
  bool b;
  double num;
  ScrStr *str;    /* SCR_HV_STRING, +1 */
  ScrHostRef ref; /* SCR_HV_OBJECT (host-owned, one count held) / SCR_HV_CLOSURE (closure id, one count held) */
};

static SCR_TL const ScrHostOps *hops;
static SCR_TL long hi_live_cells;

_Noreturn static void hi_fail(const char *what) {
  fprintf(stderr, "scriptc host island: %s\n", what);
  abort();
}

static void hi_entry(void) {
  if (hops) return;
  hops = scr_host_ops();
  if (!hops || hops->abi != SCR_HOST_ABI) hi_fail("the host's scr_host_ops() has another ABI version");
  if (hops->io_pending && hops->io_poll) scr_loop_set_io(hops->io_pending, hops->io_poll);
}

/* ── the closure table ───────────────────────────────────────────────── */

/* A compiled function the host can call: a typed closure with its per-signature adapter, or a checked-dynamic
 * function (an `unknown` value holding a function) called through its uniform thunk. */
typedef struct {
  ScrClosure *c;
  ScrJsval *(*adapt)(ScrClosure *, ScrJsval **);
  int arity;     /* negative: the island-rest shape, -(leading parameters + 1) */
  ScrDyn *dynfn; /* SCR_DYN_FUNC (owned) instead of c/adapt */
  long refs;     /* 0 = free slot */
} HiClosure;

static SCR_TL HiClosure *hi_closures;
static SCR_TL size_t hi_closures_len, hi_closures_cap, hi_closures_free_hint;

/* The live id of each typed closure, by its closure, adapter and arity: the same function handed to the host twice is
 * the same reference there, as a browser compares the function itself. removeEventListener(type, fn) then finds the
 * listener addEventListener(type, fn) added, and adding it again adds nothing. With a new id at every crossing, no
 * listener removed by its function was ever removed natively: a dragged panel kept following the mouse after its
 * release, and a screen's resize listener outlived the screen (2026-11-20). Open addressing over slot
 * indexes + 1 (0: an empty bucket), hashed by the closure's address. */
static SCR_TL size_t *hi_ids;
static SCR_TL size_t hi_ids_cap, hi_ids_len;

static size_t hi_hash(const ScrClosure *c) {
  return (size_t)(((uint64_t)(uintptr_t)c >> 4) * 0x9E3779B97F4A7C15ull);
}

/* Places a slot's index in its bucket run (room is assured by the caller). */
static void hi_ids_place(size_t slot) {
  size_t mask = hi_ids_cap - 1, i = hi_hash(hi_closures[slot].c) & mask;
  while (hi_ids[i]) i = (i + 1) & mask;
  hi_ids[i] = slot + 1;
  hi_ids_len++;
}

static void hi_ids_put(size_t slot) {
  if ((hi_ids_len + 1) * 2 > hi_ids_cap) {
    size_t *old = hi_ids, old_cap = hi_ids_cap;
    hi_ids_cap = old_cap ? old_cap * 2 : 64;
    hi_ids = calloc(hi_ids_cap, sizeof *hi_ids);
    if (!hi_ids) hi_fail("out of memory");
    hi_ids_len = 0;
    for (size_t i = 0; i < old_cap; i++)
      if (old[i]) hi_ids_place(old[i] - 1);
    free(old);
  }
  hi_ids_place(slot);
}

/* The live id (slot index + 1) of `c` with this adapter and arity, 0 for none. */
static size_t hi_ids_find(const ScrClosure *c, ScrJsval *(*adapt)(ScrClosure *, ScrJsval **), int arity) {
  if (!hi_ids_cap) return 0;
  size_t mask = hi_ids_cap - 1;
  for (size_t i = hi_hash(c) & mask; hi_ids[i]; i = (i + 1) & mask) {
    const HiClosure *e = &hi_closures[hi_ids[i] - 1];
    if (e->c == c && e->adapt == adapt && e->arity == arity) return hi_ids[i];
  }
  return 0;
}

/* Takes a slot's index out (its closure still set), and places the rest of its run again so no lookup stops short. */
static void hi_ids_remove(size_t slot) {
  if (!hi_ids_cap) return;
  size_t mask = hi_ids_cap - 1, i = hi_hash(hi_closures[slot].c) & mask;
  while (hi_ids[i] != slot + 1) {
    if (!hi_ids[i]) return;
    i = (i + 1) & mask;
  }
  hi_ids[i] = 0;
  hi_ids_len--;
  for (size_t j = (i + 1) & mask; hi_ids[j]; j = (j + 1) & mask) {
    size_t moved = hi_ids[j] - 1;
    hi_ids[j] = 0;
    hi_ids_len--;
    hi_ids_place(moved);
  }
}

static ScrHostRef hi_closure_add(HiClosure entry) {
  size_t i = hi_closures_free_hint;
  while (i < hi_closures_len && hi_closures[i].refs) i++;
  if (i == hi_closures_len) {
    if (hi_closures_len == hi_closures_cap) {
      hi_closures_cap = hi_closures_cap ? hi_closures_cap * 2 : 64;
      hi_closures = realloc(hi_closures, hi_closures_cap * sizeof *hi_closures);
      if (!hi_closures) hi_fail("out of memory");
    }
    hi_closures_len++;
  }
  entry.refs = 1;
  hi_closures[i] = entry;
  hi_closures_free_hint = i + 1;
  return (ScrHostRef)i + 1;
}

static HiClosure *hi_closure(ScrHostRef id) {
  if (id == 0 || id > hi_closures_len || !hi_closures[id - 1].refs) hi_fail("a stale closure reference");
  return &hi_closures[id - 1];
}

void scr_host_closure_retain(ScrHostRef id) { hi_closure(id)->refs++; }

void scr_host_closure_release(ScrHostRef id) {
  HiClosure *e = hi_closure(id);
  if (--e->refs) return;
  if (e->c) hi_ids_remove(id - 1);
  ScrClosure *c = e->c;
  ScrDyn *dynfn = e->dynfn;
  e->c = NULL;
  e->dynfn = NULL;
  if (id - 1 < hi_closures_free_hint) hi_closures_free_hint = id - 1;
  /* Released after the slot is free: a release may run more releases (captured cells). */
  if (c) scr_closure_release(c);
  if (dynfn) scr_dyn_release(dynfn);
}

/* ── cells ───────────────────────────────────────────────────────────── */

static ScrJsval *hi_cell(uint32_t kind) {
  ScrJsval *v = calloc(1, sizeof *v);
  if (!v) hi_fail("out of memory");
  v->rc = 1;
  v->kind = kind;
  hi_live_cells++;
  return v;
}

long scr_jsval_live_count(void) { return hi_live_cells; }

ScrJsval *scr_jsval_retain(ScrJsval *v) {
  if (v) v->rc++;
  return v;
}

void scr_jsval_release(ScrJsval *v) {
  if (!v || --v->rc) return;
  if (v->kind == SCR_HV_STRING) scr_str_release(v->str);
  else if (v->kind == SCR_HV_OBJECT) hops->release(v->ref);
  else if (v->kind == SCR_HV_CLOSURE || v->kind == SCR_HV_PROGRAM) scr_host_closure_release(v->ref);
  hi_live_cells--;
  free(v);
}

void *scr_jsval_retain_v(void *v) { return scr_jsval_retain(v); }
void scr_jsval_release_v(void *v) { scr_jsval_release(v); }

ScrJsval *scr_jsval_undefined(void) { hi_entry(); return hi_cell(SCR_HV_UNDEFINED); }
ScrJsval *scr_jsval_null(void) { hi_entry(); return hi_cell(SCR_HV_NULL); }

ScrJsval *scr_jsval_from_bool(bool b) {
  hi_entry();
  ScrJsval *v = hi_cell(SCR_HV_BOOL);
  v->b = b;
  return v;
}

ScrJsval *scr_jsval_from_f64(double x) {
  hi_entry();
  ScrJsval *v = hi_cell(SCR_HV_NUMBER);
  v->num = x;
  return v;
}

ScrJsval *scr_jsval_from_str(const ScrStr *s) {
  hi_entry();
  ScrJsval *v = hi_cell(SCR_HV_STRING);
  v->str = scr_str_retain((ScrStr *)s);
  return v;
}

/* A string cell over a fresh (+1, moved in) string. */
static ScrJsval *hi_str_cell(ScrStr *s) {
  ScrJsval *v = hi_cell(SCR_HV_STRING);
  v->str = s;
  return v;
}

#define HI_MAX_ARITY 16

ScrJsval *scr_jsval_from_closure(ScrClosure *c, int arity, ScrJsval *(*adapt)(ScrClosure *, ScrJsval **)) {
  hi_entry();
  if ((arity < 0 ? -arity : arity) > HI_MAX_ARITY) hi_fail("callback arity above 16 (the frontend fences this)");
  ScrJsval *v = hi_cell(SCR_HV_CLOSURE);
  size_t live = hi_ids_find(c, adapt, arity);
  if (live) {
    hi_closures[live - 1].refs++;
    v->ref = (ScrHostRef)live;
    return v;
  }
  v->ref = hi_closure_add((HiClosure){.c = scr_closure_retain(c), .adapt = adapt, .arity = arity});
  hi_ids_put((size_t)v->ref - 1);
  return v;
}

/* A borrowed view of a cell for the host. */
static ScrHostVal hi_view(const ScrJsval *v) {
  ScrHostVal h = {.kind = v->kind};
  switch (v->kind) {
    case SCR_HV_BOOL: h.flag = v->b; break;
    case SCR_HV_NUMBER: h.number = v->num; break;
    case SCR_HV_STRING: h.str = v->str->data; h.len = v->str->len; break;
    case SCR_HV_OBJECT: case SCR_HV_CLOSURE: case SCR_HV_PROGRAM: h.ref = v->ref; break;
    default: break;
  }
  return h;
}

/* A host result as a fresh cell (takes the host's +1 on a reference). */
static ScrJsval *hi_adopt(const ScrHostVal *h) {
  ScrJsval *v = hi_cell(h->kind);
  switch (h->kind) {
    case SCR_HV_UNDEFINED: case SCR_HV_NULL: break;
    case SCR_HV_BOOL: v->b = h->flag != 0; break;
    case SCR_HV_NUMBER: v->num = h->number; break;
    case SCR_HV_STRING: v->str = scr_str_new(h->str ? h->str : "", h->len); break;
    case SCR_HV_OBJECT: case SCR_HV_CLOSURE: case SCR_HV_PROGRAM: v->ref = h->ref; break;
    default: hi_fail("the host returned a value of an unknown kind");
  }
  return v;
}

/* A value the host lends (a callback argument, a settlement) as a fresh cell holding its own count. */
static ScrJsval *hi_borrow(const ScrHostVal *h) {
  if (h->kind == SCR_HV_OBJECT) hops->retain(h->ref);
  else if (h->kind == SCR_HV_CLOSURE || h->kind == SCR_HV_PROGRAM) scr_host_closure_retain(h->ref);
  return hi_adopt(h);
}

static void hi_type_error(const char *msg) { scr_throw_error_msg(SCR_ERR_TYPE, msg, strlen(msg)); }

static ScrJsval *hi_get(ScrJsval *o, const char *name);

/* `throw v` for a host value (borrowed): an Error object crosses as the program's error of the same name and
 * message; anything else as its String() (scr_island.c's isl_throw_reason). */
static void hi_throw_value(ScrJsval *v) {
  hi_entry();
  if (v->kind == SCR_HV_NUMBER) { scr_throw_f64(v->num); return; }
  if (v->kind == SCR_HV_BOOL) { scr_throw_bool(v->b); return; }
  if (v->kind == SCR_HV_OBJECT && hops->type_probe(v->ref, "isNativeError", 13)) {
    ScrJsval *name = hi_get(v, "name"), *message = hi_get(v, "message");
    ScrStr *n = name && name->kind == SCR_HV_STRING ? scr_str_retain(name->str) : scr_str_new("Error", 5);
    ScrStr *m = message && message->kind == SCR_HV_STRING ? scr_str_retain(message->str) : scr_str_new("", 0);
    scr_jsval_release(name);
    scr_jsval_release(message);
    if (scr_exc_pending()) scr_exc_clear(); /* a throwing getter: the fallbacks above stand */
    scr_throw_error_named(n, m);
    return;
  }
  ScrStr *s = scr_jsval_to_str(v);
  if (s) scr_throw_str(s);
}

/* A host operation's failure as the program's exception: a string is the message of a TypeError; a thrown value
 * (an Error object, a primitive) crosses as hi_throw_value does. */
static void hi_throw(const ScrHostVal *h) {
  /* A callback the host ran threw: that exception is already pending, and it is the one that propagates. */
  if (scr_exc_pending()) {
    if (h->kind == SCR_HV_OBJECT) hops->release(h->ref);
    return;
  }
  if (h->kind == SCR_HV_STRING && h->str) {
    scr_throw_error_msg(SCR_ERR_TYPE, h->str, h->len);
    return;
  }
  if (h->kind == SCR_HV_UNDEFINED) {
    scr_throw_error_msg(SCR_ERR_TYPE, "host operation failed", 21);
    return;
  }
  ScrJsval *v = hi_adopt(h);
  hi_throw_value(v);
  scr_jsval_release(v);
}

static ScrJsval *hi_result(int status, const ScrHostVal *out) {
  if (status == SCR_HOST_OK) return hi_adopt(out);
  hi_throw(out);
  return NULL;
}

/* A fresh host array of n cells (borrowed). */
static ScrJsval *hi_array_of(int n, ScrJsval *const *cells);

/* ── the pending exception as a host value ───────────────────────────── */

/* Moves the pending exception out as a cell (+1): the program's errors become host Error objects (name, message and
 * code), a thrown host value is itself, primitives stay primitives. The reverse of hi_throw_value. */
static ScrJsval *hi_take_pending(void) {
  ScrExcCell *x = scr_exc_current_cell();
  ScrJsval *v = NULL;
  switch (x->kind) {
    case SCR_EXC_F64: v = scr_jsval_from_f64(x->f64); break;
    case SCR_EXC_BOOL: v = scr_jsval_from_bool(x->b); break;
    case SCR_EXC_STR: v = scr_jsval_from_str((ScrStr *)x->payload); break;
    case SCR_EXC_OBJ:
      if (x->retain_fn == scr_jsval_retain_v) {
        v = scr_jsval_retain((ScrJsval *)x->payload);
      } else if (scr_error_is(x->payload)) {
        ScrError *err = (ScrError *)x->payload;
        ScrHostVal out = {0};
        if (hops->new_error(err->name->data, err->name->len, err->message->data, err->message->len, &out) != SCR_HOST_OK)
          hi_fail("the host could not make an Error");
        v = hi_adopt(&out);
        if (err->code) {
          ScrJsval *code = scr_jsval_from_str(err->code);
          ScrHostVal cv = hi_view(code), ignored = {0};
          hops->set_prop(v->ref, "code", 4, &cv, &ignored);
          scr_jsval_release(code);
        }
      }
      break;
    default: break;
  }
  if (!v) v = hi_str_cell(scr_str_new("[object]", 8)); /* other references render like the uncaught printer */
  scr_exc_clear();
  return v;
}

/* The taken exception lives here until the next take, so a string stays readable. */
static SCR_TL ScrJsval *hi_last_taken;

int scr_host_take_exception(ScrHostVal *out) {
  hi_entry();
  *out = (ScrHostVal){.kind = SCR_HV_UNDEFINED};
  if (!scr_exc_pending()) return 0;
  scr_jsval_release(hi_last_taken);
  hi_last_taken = hi_take_pending();
  *out = hi_view(hi_last_taken);
  /* The host owns the reference it is handed. */
  if (out->kind == SCR_HV_OBJECT) hops->retain(out->ref);
  else if (out->kind == SCR_HV_CLOSURE || out->kind == SCR_HV_PROGRAM) scr_host_closure_retain(out->ref);
  return 1;
}

/* ── receivers ───────────────────────────────────────────────────────── */

/* UTF-16 length of a UTF-8 (WTF-8) string: what `s.length` answers. */
static double hi_utf16_len(const ScrStr *s) {
  size_t units = 0;
  for (size_t i = 0; i < s->len; i++) {
    unsigned char c = (unsigned char)s->data[i];
    if ((c & 0xC0) != 0x80) units += c >= 0xF0 ? 2 : 1;
  }
  return (double)units;
}

/* The receiver a property operation needs: a host object. Reading off a primitive answers through hi_primitive_get;
 * null and undefined throw V8's text. */
static bool hi_object(const ScrJsval *o, const char *what, const ScrStr *name) {
  if (o->kind == SCR_HV_OBJECT) return true;
  char msg[256];
  if (o->kind == SCR_HV_UNDEFINED || o->kind == SCR_HV_NULL) {
    snprintf(msg, sizeof msg, "Cannot %s properties of %s (%s '%.*s')", what, o->kind == SCR_HV_NULL ? "null" : "undefined",
             strcmp(what, "set") == 0 ? "setting" : "reading", name ? (int)name->len : 0, name ? name->data : "");
  } else {
    snprintf(msg, sizeof msg, "cannot %s property '%.*s' of a primitive or compiled value on the host island", what,
             name ? (int)name->len : 0, name ? name->data : "");
  }
  hi_type_error(msg);
  return false;
}

/* A property read off a primitive: a string's length; any other name is undefined (the host island carries no
 * String/Number prototypes). */
static ScrJsval *hi_primitive_get(const ScrJsval *o, const ScrStr *name) {
  if (o->kind == SCR_HV_STRING && name->len == 6 && memcmp(name->data, "length", 6) == 0) return scr_jsval_from_f64(hi_utf16_len(o->str));
  return scr_jsval_undefined();
}

/* ── globals, properties, calls ──────────────────────────────────────── */

/* A static import of a page module the program could not compile (a package left to the page, a Vite `?worker`
 * module): the embedding application supplies no modules, so it is undefined, as the WasmGC native host answers
 * island.import. The failure lands where the value is used (calling it throws "is not a function"), and code that
 * never uses it, as a build-flag-guarded call, runs on. Noted once per specifier on stderr. */
ScrJsval *scr_jsval_import(const ScrStr *key, const ScrStr *name, const ScrStr *specifier) {
  /* The embedding application may supply the module after all: its host answers the typed host module
   * "scriptc:page-import", function "import" (key, export name, specifier), with the export, or undefined when it does
   * not supply it. A host without that module throws, which reads as not supplied: the answer is today's. */
  hi_entry();
  if (hops->module_call) {
    static const char module[] = "scriptc:page-import", fn[] = "import";
    ScrHostVal argv[3] = {
        {.kind = SCR_HV_STRING, .str = key->data, .len = key->len},
        {.kind = SCR_HV_STRING, .str = name->data, .len = name->len},
        {.kind = SCR_HV_STRING, .str = specifier->data, .len = specifier->len},
    };
    ScrHostVal out = {0};
    int status = hops->module_call(module, sizeof module - 1, fn, sizeof fn - 1, 3, argv, &out);
    if (status == SCR_HOST_OK) {
      if (out.kind != SCR_HV_UNDEFINED) return hi_adopt(&out);
    } else if (out.kind == SCR_HV_OBJECT) {
      hops->release(out.ref);
    } else if (out.kind == SCR_HV_CLOSURE || out.kind == SCR_HV_PROGRAM) {
      scr_host_closure_release(out.ref);
    }
  }
  enum { NOTED_MAX = 32 };
  static SCR_TL char *noted[NOTED_MAX];
  static SCR_TL size_t noted_count;
  bool seen = false;
  for (size_t i = 0; i < noted_count; i++) {
    if (strlen(noted[i]) == specifier->len && memcmp(noted[i], specifier->data, specifier->len) == 0) seen = true;
  }
  if (!seen) {
    fprintf(stderr, "native host: page module \"%.*s\" (import %.*s, key %.*s) is not supplied; its imports are undefined\n",
            (int)specifier->len, specifier->data, (int)name->len, name->data, (int)key->len, key->data);
    if (noted_count < NOTED_MAX) {
      char *copy = malloc(specifier->len + 1);
      if (copy) {
        memcpy(copy, specifier->data, specifier->len);
        copy[specifier->len] = 0;
        noted[noted_count++] = copy;
      }
    }
  }
  return scr_jsval_undefined();
}

ScrJsval *scr_jsval_global_get(const ScrStr *name) {
  hi_entry();
  ScrHostVal out = {0};
  return hi_result(hops->global_get(name->data, name->len, &out), &out);
}

ScrJsval *scr_jsval_get_prop(ScrJsval *o, const ScrStr *name) {
  hi_entry();
  if (o->kind == SCR_HV_STRING || o->kind == SCR_HV_NUMBER || o->kind == SCR_HV_BOOL) return hi_primitive_get(o, name);
  if (!hi_object(o, "read", name)) return NULL;
  ScrHostVal out = {0};
  return hi_result(hops->get_prop(o->ref, name->data, name->len, &out), &out);
}

/* get_prop by a C name (+1, or NULL pending). */
static ScrJsval *hi_get(ScrJsval *o, const char *name) {
  if (o->kind != SCR_HV_OBJECT) return scr_jsval_undefined();
  ScrHostVal out = {0};
  return hi_result(hops->get_prop(o->ref, name, strlen(name), &out), &out);
}

int scr_jsval_set_prop(ScrJsval *o, const ScrStr *name, ScrJsval *v) {
  hi_entry();
  if (!hi_object(o, "set", name)) return 0;
  ScrHostVal value = hi_view(v), out = {0};
  if (hops->set_prop(o->ref, name->data, name->len, &value, &out) == SCR_HOST_OK) return 1;
  hi_throw(&out);
  return 0;
}

/* A property key cell as its name (numbers in their String() form). +1 out. */
static ScrStr *hi_key(ScrJsval *key) {
  if (key->kind == SCR_HV_STRING) return scr_str_retain(key->str);
  if (key->kind == SCR_HV_NUMBER) return scr_f64_to_scrstr(key->num);
  if (key->kind == SCR_HV_BOOL || key->kind == SCR_HV_NULL || key->kind == SCR_HV_UNDEFINED) return scr_jsval_to_str(key);
  hi_type_error("the host island takes primitive property keys only");
  return NULL;
}

ScrJsval *scr_jsval_get_idx(ScrJsval *o, ScrJsval *key) {
  ScrStr *name = hi_key(key);
  if (!name) return NULL;
  ScrJsval *r = scr_jsval_get_prop(o, name);
  scr_str_release(name);
  return r;
}

int scr_jsval_set_idx(ScrJsval *o, ScrJsval *key, ScrJsval *v) {
  ScrStr *name = hi_key(key);
  if (!name) return 0;
  int r = scr_jsval_set_prop(o, name, v);
  scr_str_release(name);
  return r;
}

/* Arguments as borrowed views: a small stack buffer, else the heap. */
#define HI_STACK_ARGS 8
static ScrHostVal *hi_views(int argc, ScrJsval *const *argv, ScrHostVal *stack) {
  ScrHostVal *a = argc <= HI_STACK_ARGS ? stack : malloc((size_t)argc * sizeof *a);
  if (!a) hi_fail("out of memory");
  for (int i = 0; i < argc; i++) a[i] = hi_view(argv[i]);
  return a;
}

static ScrJsval *hi_array_of(int n, ScrJsval *const *cells) {
  ScrHostVal stack[HI_STACK_ARGS], out = {0};
  ScrHostVal *a = hi_views(n, cells, stack);
  int st = hops->new_array(n, a, &out);
  if (a != stack) free(a);
  if (st != SCR_HOST_OK) hi_fail("the host could not make an array");
  return hi_adopt(&out);
}

/* A checked-dynamic function called with host values: arguments wrap as dyn values (scalars normalize), the thunk
 * validates and runs, the dyn result converts back (scr_island.c's isl_dynfn_invoke). */
static ScrJsval *hi_call_dynfn(ScrDyn *box, int argc, ScrJsval *const *argv) {
  ScrDyn *stack[HI_STACK_ARGS];
  ScrDyn **dargs = argc <= HI_STACK_ARGS ? stack : malloc((size_t)argc * sizeof *dargs);
  if (!dargs) hi_fail("out of memory");
  for (int i = 0; i < argc; i++) dargs[i] = scr_dyn_from_jsval(argv[i]);
  scr_dyn_retain(box);
  ScrDyn *r = box->v.fn.thunk(box->v.fn.clo, dargs, (size_t)argc);
  scr_dyn_release(box);
  for (int i = 0; i < argc; i++) scr_dyn_release(dargs[i]);
  if (dargs != stack) free(dargs);
  if (scr_exc_pending()) {
    scr_dyn_release(r);
    return NULL;
  }
  if (!r) return scr_jsval_undefined();
  ScrJsval *out = scr_jsval_from_dyn(r);
  scr_dyn_release(r);
  return out;
}

/* Calling a compiled closure through a jsval (a callback read back from the host, or the host calling it). Missing
 * arguments are undefined, extra ones dropped; the island-rest shape gets the surplus as a fresh host array. */
static ScrJsval *hi_call_closure(ScrHostRef id, int argc, ScrJsval *const *argv) {
  HiClosure e = *hi_closure(id); /* a copy: the table may grow during the call */
  if (e.dynfn) return hi_call_dynfn(e.dynfn, argc, argv);
  int leading = e.arity < 0 ? -e.arity - 1 : e.arity;
  int ncells = e.arity < 0 ? leading + 1 : leading;
  ScrJsval *cells[HI_MAX_ARITY + 1];
  for (int i = 0; i < leading; i++) cells[i] = i < argc ? scr_jsval_retain(argv[i]) : scr_jsval_undefined();
  if (e.arity < 0) cells[leading] = hi_array_of(argc > leading ? argc - leading : 0, argv + (argc > leading ? leading : argc));
  /* The closure stays alive through its own call (a callback may drop the host's last reference to itself). */
  scr_closure_retain(e.c);
  ScrJsval *r = e.adapt(e.c, cells);
  scr_closure_release(e.c);
  for (int i = 0; i < ncells; i++) scr_jsval_release(cells[i]);
  /* The adapter signals a throw by the pending exception alone; a NULL result is undefined (a void callback). */
  if (scr_exc_pending()) {
    scr_jsval_release(r);
    return NULL;
  }
  return r ? r : scr_jsval_undefined();
}

static ScrJsval *hi_call(ScrJsval *f, ScrHostRef this_ref, int argc, ScrJsval *const *argv) {
  hi_entry();
  if (f->kind == SCR_HV_CLOSURE) return hi_call_closure(f->ref, argc, argv);
  if (f->kind != SCR_HV_OBJECT) { hi_type_error("not a function"); return NULL; }
  ScrHostVal stack[HI_STACK_ARGS], out = {0};
  ScrHostVal *a = hi_views(argc, argv, stack);
  int st = hops->call(f->ref, this_ref, argc, a, &out);
  if (a != stack) free(a);
  return hi_result(st, &out);
}

ScrJsval *scr_jsval_call(ScrJsval *f, int argc, ScrJsval **argv) { return hi_call(f, 0, argc, argv); }

ScrJsval *scr_jsval_call_this(ScrJsval *f, ScrJsval *receiver, int argc, ScrJsval **argv) {
  return hi_call(f, receiver->kind == SCR_HV_OBJECT ? receiver->ref : 0, argc, argv);
}

static ScrJsval **hi_drain(ScrJsval *v, const ScrStr *spell, size_t *n);

/* Function.prototype.call / apply on a compiled function (the receiver is dropped: a compiled closure takes none). */
static ScrJsval *hi_closure_method(ScrJsval *f, const ScrStr *name, int argc, ScrJsval **argv) {
  if (name->len == 4 && memcmp(name->data, "call", 4) == 0) return hi_call(f, 0, argc > 0 ? argc - 1 : 0, argv + (argc > 0));
  if (name->len == 5 && memcmp(name->data, "apply", 5) == 0) {
    if (argc < 2 || scr_jsval_is_nullish(argv[1])) return hi_call(f, 0, 0, NULL);
    size_t n = 0;
    ScrJsval **args = hi_drain(argv[1], NULL, &n);
    if (!args) return NULL;
    ScrJsval *r = hi_call(f, 0, (int)n, args);
    for (size_t i = 0; i < n; i++) scr_jsval_release(args[i]);
    free(args);
    return r;
  }
  char msg[256];
  snprintf(msg, sizeof msg, "the host island has no '%.*s' on compiled functions", (int)name->len, name->data);
  hi_type_error(msg);
  return NULL;
}

ScrJsval *scr_jsval_call_method(ScrJsval *o, const ScrStr *name, int argc, ScrJsval **argv) {
  hi_entry();
  if (o->kind == SCR_HV_CLOSURE) return hi_closure_method(o, name, argc, argv);
  if (o->kind == SCR_HV_STRING || o->kind == SCR_HV_NUMBER || o->kind == SCR_HV_BOOL) {
    char msg[256];
    snprintf(msg, sizeof msg, "the host island has no methods on primitives ('%.*s')", (int)name->len, name->data);
    hi_type_error(msg);
    return NULL;
  }
  if (!hi_object(o, "read", name)) return NULL;
  ScrHostVal stack[HI_STACK_ARGS], out = {0};
  ScrHostVal *a = hi_views(argc, argv, stack);
  int st = hops->call_method(o->ref, name->data, name->len, argc, a, &out);
  if (a != stack) free(a);
  return hi_result(st, &out);
}

/* call_method by a C name. */
static ScrJsval *hi_call_method(ScrJsval *o, const char *name, int argc, ScrJsval *const *argv) {
  ScrHostVal stack[HI_STACK_ARGS], out = {0};
  ScrHostVal *a = hi_views(argc, argv, stack);
  int st = hops->call_method(o->ref, name, strlen(name), argc, a, &out);
  if (a != stack) free(a);
  return hi_result(st, &out);
}

ScrJsval *scr_jsval_opt_call_method(ScrJsval *o, const ScrStr *name, int argc, ScrJsval **argv) {
  hi_entry();
  if (o->kind == SCR_HV_UNDEFINED || o->kind == SCR_HV_NULL) return scr_jsval_undefined();
  ScrJsval *fn = scr_jsval_get_prop(o, name);
  if (!fn) return NULL;
  if (fn->kind == SCR_HV_UNDEFINED || fn->kind == SCR_HV_NULL) return fn;
  ScrJsval *r = hi_call(fn, o->kind == SCR_HV_OBJECT ? o->ref : 0, argc, argv);
  scr_jsval_release(fn);
  return r;
}

ScrJsval *scr_jsval_construct(ScrJsval *f, int argc, ScrJsval **argv) {
  hi_entry();
  if (f->kind != SCR_HV_OBJECT) { hi_type_error("not a constructor"); return NULL; }
  ScrHostVal stack[HI_STACK_ARGS], out = {0};
  ScrHostVal *a = hi_views(argc, argv, stack);
  int st = hops->construct(f->ref, argc, a, &out);
  if (a != stack) free(a);
  return hi_result(st, &out);
}

int scr_jsval_instance_of(ScrJsval *v, ScrJsval *c) {
  hi_entry();
  if (c->kind != SCR_HV_OBJECT) { hi_type_error("Right-hand side of 'instanceof' is not callable"); return -1; }
  return v->kind == SCR_HV_OBJECT && hops->instance_of(v->ref, c->ref);
}

/* ── the host calling back into the program ──────────────────────────── */

/* A callback's string result stays readable until the next call. */
static SCR_TL ScrJsval *hi_last_result;

int scr_host_closure_call(ScrHostRef id, int argc, const ScrHostVal *argv, ScrHostVal *out) {
  hi_entry();
  ScrJsval *stack[HI_STACK_ARGS];
  ScrJsval **cells = argc <= HI_STACK_ARGS ? stack : malloc((size_t)argc * sizeof *cells);
  if (!cells) hi_fail("out of memory");
  /* The host's references stay the host's: each cell takes its own count. */
  for (int i = 0; i < argc; i++) cells[i] = hi_borrow(&argv[i]);
  ScrJsval *r = hi_call_closure(id, argc, cells);
  for (int i = 0; i < argc; i++) scr_jsval_release(cells[i]);
  if (cells != stack) free(cells);
  scr_jsval_release(hi_last_result);
  hi_last_result = r;
  *out = (ScrHostVal){.kind = SCR_HV_UNDEFINED};
  /* A throw stays pending: the loop reports it as an uncaught callback error, as Node does (or the host takes it). */
  if (!r) return SCR_HOST_THREW;
  *out = hi_view(r);
  return SCR_HOST_OK;
}

/* ── literals ────────────────────────────────────────────────────────── */

static ScrJsval *hi_new_object(void) {
  ScrHostVal out = {0};
  if (hops->new_object(&out) != SCR_HOST_OK) hi_fail("the host could not make an object");
  return hi_adopt(&out);
}

/* obj[name] = v by a borrowed name span; 0 with the exception pending. */
static int hi_set(ScrJsval *obj, const char *name, size_t len, ScrJsval *v) {
  ScrHostVal value = hi_view(v), out = {0};
  if (hops->set_prop(obj->ref, name, len, &value, &out) == SCR_HOST_OK) return 1;
  hi_throw(&out);
  return 0;
}

ScrJsval *scr_jsval_obj_lit(int npairs, ScrJsval **kv) {
  hi_entry();
  ScrJsval *o = hi_new_object();
  for (int i = 0; i < npairs; i++) {
    ScrStr *k = hi_key(kv[2 * i]);
    if (!k) hi_fail("an object literal key the host island cannot spell");
    if (!hi_set(o, k->data, k->len, kv[2 * i + 1])) hi_fail("the host refused an object literal member");
    scr_str_release(k);
  }
  return o;
}

ScrJsval *scr_jsval_arr_lit(int n, ScrJsval **elems) {
  hi_entry();
  return hi_array_of(n, elems);
}

/* The TemplateStringsArray for a tag call on a host function: n cooked strings, then n raw ones as its `.raw`. */
ScrJsval *scr_jsval_tpl_strings(int n, ScrJsval **kv) {
  hi_entry();
  ScrJsval *cooked = hi_array_of(n, kv), *raw = hi_array_of(n, kv + n);
  if (!hi_set(cooked, "raw", 3, raw)) hi_fail("the host refused a template's raw strings");
  scr_jsval_release(raw);
  return cooked;
}

/* Object.keys(o) of a host object as cells: *n of them in a fresh malloc'd vector (+1 each). NULL pending. */
static ScrJsval **hi_keys(ScrJsval *o, size_t *n);

/* UTF-8 sequence length at a lead byte. */
static size_t hi_utf8_len(unsigned char c) { return c < 0x80 ? 1 : c >= 0xF0 ? 4 : c >= 0xE0 ? 3 : c >= 0xC0 ? 2 : 1; }

/* Spread completion for an object literal: CopyDataProperties of `src` onto `obj` (null/undefined and the other
 * primitives copy nothing; a string copies its characters by index). +1 the target, NULL pending. */
ScrJsval *scr_jsval_obj_spread(ScrJsval *obj, ScrJsval *src) {
  hi_entry();
  if (src->kind == SCR_HV_STRING) {
    size_t index = 0;
    for (size_t i = 0; i < src->str->len; index++) {
      size_t n = hi_utf8_len((unsigned char)src->str->data[i]);
      if (i + n > src->str->len) n = src->str->len - i;
      ScrJsval *ch = hi_str_cell(scr_str_new(src->str->data + i, n));
      char key[24];
      int kl = snprintf(key, sizeof key, "%zu", index);
      int ok = hi_set(obj, key, (size_t)kl, ch);
      scr_jsval_release(ch);
      if (!ok) return NULL;
      /* An astral character is two UTF-16 indices. */
      if (n == 4) index++;
      i += n;
    }
    return scr_jsval_retain(obj);
  }
  if (src->kind != SCR_HV_OBJECT) return scr_jsval_retain(obj);
  size_t n = 0;
  ScrJsval **keys = hi_keys(src, &n);
  if (!keys) return NULL;
  bool ok = true;
  for (size_t i = 0; i < n; i++) {
    if (ok) {
      ScrJsval *v = scr_jsval_get_prop(src, keys[i]->str);
      ok = v && hi_set(obj, keys[i]->str->data, keys[i]->str->len, v);
      scr_jsval_release(v);
    }
    scr_jsval_release(keys[i]);
  }
  free(keys);
  return ok ? scr_jsval_retain(obj) : NULL;
}

/* Getter completion for an object literal: `key` on `obj` as an enumerable accessor calling `fn`. +1 the object. */
ScrJsval *scr_jsval_define_getter(ScrJsval *obj, ScrJsval *key, ScrJsval *fn) {
  hi_entry();
  ScrStr *k = hi_key(key);
  if (!k) hi_fail("a getter key the host island cannot spell");
  ScrHostVal getter = hi_view(fn), out = {0};
  if (hops->define_getter(obj->ref, k->data, k->len, &getter, &out) != SCR_HOST_OK) hi_fail("the host refused a getter");
  scr_str_release(k);
  return scr_jsval_retain(obj);
}

static ScrJsval **hi_keys(ScrJsval *o, size_t *n) {
  ScrHostVal out = {0};
  ScrJsval *arr = hi_result(hops->own_keys(o->ref, &out), &out);
  if (!arr) return NULL;
  ScrJsval *len = hi_get(arr, "length");
  size_t count = len && len->kind == SCR_HV_NUMBER ? (size_t)len->num : 0;
  scr_jsval_release(len);
  ScrJsval **keys = malloc((count ? count : 1) * sizeof *keys);
  if (!keys) hi_fail("out of memory");
  for (size_t i = 0; i < count; i++) {
    char idx[24];
    snprintf(idx, sizeof idx, "%zu", i);
    keys[i] = hi_get(arr, idx);
    if (!keys[i] || keys[i]->kind != SCR_HV_STRING) hi_fail("the host's own_keys answered a non-string key");
  }
  scr_jsval_release(arr);
  *n = count;
  return keys;
}

/* ── iteration ───────────────────────────────────────────────────────── */

/* V8's not-iterable wording for a value (the prelude helpers' `d`). */
static void hi_not_iterable(ScrJsval *v, const ScrStr *spell) {
  if (spell && spell->len) {
    scr_throw_error_msg(SCR_ERR_TYPE, spell->data, spell->len);
    return;
  }
  char msg[160];
  const char *tail = " is not iterable (cannot read property Symbol(Symbol.iterator))";
  switch (v->kind) {
    case SCR_HV_UNDEFINED: snprintf(msg, sizeof msg, "undefined%s", tail); break;
    case SCR_HV_NULL: snprintf(msg, sizeof msg, "object null%s", tail); break;
    case SCR_HV_BOOL: snprintf(msg, sizeof msg, "boolean %s%s", v->b ? "true" : "false", tail); break;
    case SCR_HV_NUMBER: {
      ScrStr *s = scr_f64_to_scrstr(v->num);
      snprintf(msg, sizeof msg, "number %.*s%s", (int)s->len, s->data, tail);
      scr_str_release(s);
      break;
    }
    case SCR_HV_CLOSURE: snprintf(msg, sizeof msg, "function%s", tail); break;
    default: snprintf(msg, sizeof msg, "object%s", tail); break;
  }
  hi_type_error(msg);
}

/* A string's code points as a fresh host array (a string iterates by code point). */
static ScrJsval *hi_code_points(const ScrStr *s) {
  size_t count = 0;
  for (size_t i = 0; i < s->len; count++) i += hi_utf8_len((unsigned char)s->data[i]);
  ScrJsval **cells = malloc((count ? count : 1) * sizeof *cells);
  if (!cells) hi_fail("out of memory");
  size_t at = 0;
  for (size_t k = 0; k < count; k++) {
    size_t n = hi_utf8_len((unsigned char)s->data[at]);
    if (at + n > s->len) n = s->len - at;
    cells[k] = hi_str_cell(scr_str_new(s->data + at, n));
    at += n;
  }
  ScrJsval *arr = hi_array_of((int)count, cells);
  for (size_t k = 0; k < count; k++) scr_jsval_release(cells[k]);
  free(cells);
  return arr;
}

/* GetIterator(v): a host iterator (+1), or NULL with V8's TypeError (or `spell` verbatim) pending. */
static ScrJsval *hi_iterator(ScrJsval *v, const ScrStr *spell) {
  ScrJsval *source = v->kind == SCR_HV_STRING ? hi_code_points(v->str) : scr_jsval_retain(v);
  ScrJsval *it = NULL;
  if (source->kind == SCR_HV_OBJECT) {
    ScrHostVal out = {0};
    if (hops->get_iterator(source->ref, &out) == SCR_HOST_OK) it = hi_adopt(&out);
    else if (out.kind == SCR_HV_OBJECT) hops->release(out.ref);
  }
  scr_jsval_release(source);
  if (!it) hi_not_iterable(v, spell);
  return it;
}

/* IteratorStep: 1 with *value (+1), 0 when done, -1 pending. */
static int hi_step(ScrJsval *it, ScrJsval **value) {
  ScrJsval *r = hi_call_method(it, "next", 0, NULL);
  if (!r) return -1;
  if (r->kind != SCR_HV_OBJECT) {
    scr_jsval_release(r);
    hi_type_error("Iterator result is not an object");
    return -1;
  }
  ScrJsval *done = hi_get(r, "done");
  if (!done) { scr_jsval_release(r); return -1; }
  bool finished = scr_jsval_truthy(done);
  scr_jsval_release(done);
  if (finished) { scr_jsval_release(r); return 0; }
  *value = hi_get(r, "value");
  scr_jsval_release(r);
  return *value ? 1 : -1;
}

/* The whole iteration of v as cells: a fresh vector of *n (+1 each), or NULL pending. */
static ScrJsval **hi_drain(ScrJsval *v, const ScrStr *spell, size_t *n) {
  ScrJsval *it = hi_iterator(v, spell);
  if (!it) return NULL;
  size_t len = 0, cap = 8;
  ScrJsval **cells = malloc(cap * sizeof *cells);
  if (!cells) hi_fail("out of memory");
  for (;;) {
    ScrJsval *x = NULL;
    int st = hi_step(it, &x);
    if (st == 0) break;
    if (st < 0) {
      for (size_t i = 0; i < len; i++) scr_jsval_release(cells[i]);
      free(cells);
      scr_jsval_release(it);
      return NULL;
    }
    if (len == cap) {
      cap *= 2;
      cells = realloc(cells, cap * sizeof *cells);
      if (!cells) hi_fail("out of memory");
    }
    cells[len++] = x;
  }
  scr_jsval_release(it);
  *n = len;
  return cells;
}

ScrJsval *scr_jsval_iter_new(ScrJsval *v) {
  hi_entry();
  return hi_iterator(v, NULL);
}

/* Destructuring GetIterator + the pattern's width: exactly n elements, undefined-padded, with IteratorClose (the
 * iterator's `return`, when it has one) when it was not exhausted. */
ScrJsval *scr_jsval_iter_n(ScrJsval *v, double n) {
  hi_entry();
  ScrJsval *it = hi_iterator(v, NULL);
  if (!it) return NULL;
  size_t want = n > 0 ? (size_t)n : 0;
  ScrJsval **cells = malloc((want ? want : 1) * sizeof *cells);
  if (!cells) hi_fail("out of memory");
  bool done = false;
  size_t got = 0;
  for (; got < want; got++) {
    ScrJsval *x = NULL;
    int st = done ? 0 : hi_step(it, &x);
    if (st < 0) break;
    if (st == 0) done = true;
    cells[got] = st == 1 ? x : scr_jsval_undefined();
  }
  ScrJsval *out = NULL;
  if (got == want) {
    if (!done) {
      ScrJsval *ret = hi_get(it, "return");
      if (ret && (ret->kind == SCR_HV_CLOSURE || (ret->kind == SCR_HV_OBJECT && hops->is_callable(ret->ref)))) {
        ScrJsval *r = hi_call(ret, it->ref, 0, NULL);
        scr_jsval_release(r);
      }
      scr_jsval_release(ret);
    }
    if (!scr_exc_pending()) out = hi_array_of((int)want, cells);
  }
  for (size_t i = 0; i < got; i++) scr_jsval_release(cells[i]);
  free(cells);
  scr_jsval_release(it);
  return out;
}

/* Destructuring RequireObjectCoercible with V8's exact text; every other value passes through (+1). */
ScrJsval *scr_jsval_destr_check(ScrJsval *v, const char *spell, const char *first) {
  hi_entry();
  if (v->kind != SCR_HV_UNDEFINED && v->kind != SCR_HV_NULL) return scr_jsval_retain(v);
  const char *k = v->kind == SCR_HV_UNDEFINED ? "undefined" : "null";
  char msg[512];
  if (first) snprintf(msg, sizeof msg, "Cannot destructure property '%s' of '%s' as it is %s.", first, spell, k);
  else snprintf(msg, sizeof msg, "Cannot destructure '%s' as it is %s.", spell, k);
  hi_type_error(msg);
  return NULL;
}

/* `f(...pre, ...spread)` on a host callee: V8's spread-call TypeErrors first (`what` spells the spread expression),
 * then both iterations drained into one argument list. */
ScrJsval *scr_jsval_call_spread(ScrJsval *f, ScrJsval *pre, ScrJsval *spread, const ScrStr *what) {
  hi_entry();
  if (spread->kind == SCR_HV_UNDEFINED || spread->kind == SCR_HV_NULL) {
    char msg[320];
    snprintf(msg, sizeof msg, "%.*s is not iterable (cannot read property %s)", (int)what->len, what->data,
             spread->kind == SCR_HV_NULL ? "null" : "undefined");
    hi_type_error(msg);
    return NULL;
  }
  static SCR_TL const ScrStr *spread_text;
  if (!spread_text) {
    static const char t[] = "Spread syntax requires ...iterable[Symbol.iterator] to be a function";
    spread_text = scr_str_new(t, sizeof t - 1);
  }
  size_t npre = 0, nspread = 0;
  ScrJsval **a = hi_drain(pre, NULL, &npre);
  if (!a) return NULL;
  ScrJsval **b = hi_drain(spread, spread_text, &nspread);
  ScrJsval *r = NULL;
  if (b) {
    ScrJsval **all = malloc((npre + nspread + 1) * sizeof *all);
    if (!all) hi_fail("out of memory");
    memcpy(all, a, npre * sizeof *all);
    memcpy(all + npre, b, nspread * sizeof *all);
    r = hi_call(f, 0, (int)(npre + nspread), all);
    free(all);
    for (size_t i = 0; i < nspread; i++) scr_jsval_release(b[i]);
    free(b);
  }
  for (size_t i = 0; i < npre; i++) scr_jsval_release(a[i]);
  free(a);
  return r;
}

/* ── exits, tests and conversions ────────────────────────────────────── */

static void hi_exit_fail(const char *want, ScrJsval *v) {
  ScrStr *got = scr_jsval_typeof(v);
  char msg[128];
  snprintf(msg, sizeof msg, "expected %s, got %.*s", want, (int)got->len, got->data);
  scr_str_release(got);
  hi_type_error(msg);
}

int scr_jsval_exit_f64(ScrJsval *v, double *out) {
  if (v->kind != SCR_HV_NUMBER) { hi_exit_fail("number", v); return 0; }
  *out = v->num;
  return 1;
}

int scr_jsval_exit_bool(ScrJsval *v, bool *out) {
  if (v->kind != SCR_HV_BOOL) { hi_exit_fail("boolean", v); return 0; }
  *out = v->b;
  return 1;
}

ScrStr *scr_jsval_exit_str(ScrJsval *v) {
  if (v->kind != SCR_HV_STRING) { hi_exit_fail("string", v); return NULL; }
  return scr_str_retain(v->str);
}

/* Validated Uint8Array exit: a fresh u8 copy (+1), the boundary's aliasing stance; NULL with the TypeError pending. */
ScrBytes *scr_jsval_exit_bytes(ScrJsval *v) {
  hi_entry();
  uint32_t elem = 0;
  const uint8_t *data = NULL;
  size_t n = 0;
  if (v->kind != SCR_HV_OBJECT || !hops->bytes_view(v->ref, &elem, &data, &n) || elem != SCR_BYTES_U8) {
    hi_exit_fail("a Uint8Array", v);
    return NULL;
  }
  ScrBytes *b = scr_bytes_new(SCR_BYTES_U8, (double)n);
  if (n > 0) memcpy(b->data, data, n);
  return b;
}

/* A typed array crossing in: a host typed array of the same element kind, a copy. */
ScrJsval *scr_jsval_from_bytes(const ScrBytes *b) {
  hi_entry();
  ScrHostVal out = {0};
  size_t size = b->len * scr_bytes_elem_size(b->elem);
  /* The host keeps the array's storage alive by its owner (+1 here, given back through scr_host_bytes_release). */
  ScrBytes *owner = scr_bytes_retain((ScrBytes *)b);
  if (hops->new_bytes_owned((uint32_t)b->elem, b->data, size, b->data, owner, &out) != SCR_HOST_OK) {
    scr_bytes_release(owner);
    hi_fail("the host could not make a typed array");
  }
  return hi_adopt(&out);
}

void scr_host_bytes_release(void *owner) {
  scr_bytes_release((ScrBytes *)owner);
}

/* A URL has no host-side class yet: the crossing refuses catchably rather than hand over a lookalike. */
ScrJsval *scr_jsval_from_url(ScrUrl *u) {
  (void)u;
  hi_type_error("a URL value cannot cross into the host island yet (pass its href)");
  return NULL;
}

/* `any[]`-declared slot exit: Array.isArray-gated, elements by reference into a native array of cells (identity
 * crosses, the spine is a snapshot copy). +1, or NULL pending. */
ScrArr *scr_jsval_exit_jsval_arr(ScrJsval *v) {
  hi_entry();
  if (v->kind != SCR_HV_OBJECT || !hops->is_array(v->ref)) {
    hi_exit_fail("an array", v);
    return NULL;
  }
  ScrJsval *len = hi_get(v, "length");
  if (!len) return NULL;
  size_t n = len->kind == SCR_HV_NUMBER && len->num > 0 ? (size_t)len->num : 0;
  scr_jsval_release(len);
  static ScrArrOps jsval_ops = { &scr_jsval_retain_v, &scr_jsval_release_v, NULL };
  ScrArr *out = scr_arr_new_ops(&jsval_ops, n);
  for (size_t i = 0; i < n; i++) {
    char idx[24];
    snprintf(idx, sizeof idx, "%zu", i);
    ScrJsval *e = hi_get(v, idx);
    if (!e) {
      scr_arr_release(out);
      return NULL;
    }
    scr_arr_push_ref(out, e); /* the cell's count moves in */
  }
  return out;
}

void scr_jsval_cast_fail(ScrJsval *v, const ScrStr *target) {
  (void)v;
  char msg[512];
  snprintf(msg, sizeof msg, "island value cannot be validated as '%.*s' (the type has no island exit — functions and promises cannot cross the boundary)",
           (int)target->len, target->data);
  hi_type_error(msg);
}

bool scr_jsval_is_undefined(ScrJsval *v) { return v->kind == SCR_HV_UNDEFINED; }
bool scr_jsval_is_nullish(ScrJsval *v) { return v->kind == SCR_HV_UNDEFINED || v->kind == SCR_HV_NULL; }
bool scr_jsval_is_object(ScrJsval *v) { return v->kind == SCR_HV_OBJECT || v->kind == SCR_HV_CLOSURE || v->kind == SCR_HV_PROGRAM; }

int scr_jsval_truthy(ScrJsval *v) {
  switch (v->kind) {
    case SCR_HV_BOOL: return v->b;
    case SCR_HV_NUMBER: return !(v->num == 0 || isnan(v->num));
    case SCR_HV_STRING: return v->str->len != 0;
    case SCR_HV_OBJECT: case SCR_HV_CLOSURE: case SCR_HV_PROGRAM: return 1;
    default: return 0;
  }
}

static bool hi_callable(const ScrJsval *v) {
  return v->kind == SCR_HV_CLOSURE || (v->kind == SCR_HV_OBJECT && hops->is_callable(v->ref));
}

ScrStr *scr_jsval_typeof(ScrJsval *v) {
  hi_entry();
  const char *t;
  switch (v->kind) {
    case SCR_HV_UNDEFINED: t = "undefined"; break;
    case SCR_HV_BOOL: t = "boolean"; break;
    case SCR_HV_NUMBER: t = "number"; break;
    case SCR_HV_STRING: t = "string"; break;
    case SCR_HV_CLOSURE: t = "function"; break;
    case SCR_HV_OBJECT: t = hops->is_callable(v->ref) ? "function" : "object"; break;
    default: t = "object"; break; /* null */
  }
  return scr_str_new(t, strlen(t));
}

ScrStr *scr_jsval_to_str(ScrJsval *v) {
  hi_entry();
  switch (v->kind) {
    case SCR_HV_UNDEFINED: return scr_str_new("undefined", 9);
    case SCR_HV_NULL: return scr_str_new("null", 4);
    case SCR_HV_BOOL: return v->b ? scr_str_new("true", 4) : scr_str_new("false", 5);
    case SCR_HV_NUMBER: return scr_f64_to_scrstr(v->num);
    case SCR_HV_STRING: return scr_str_retain(v->str);
    case SCR_HV_CLOSURE: return scr_str_new("function () { [native code] }", 29);
    case SCR_HV_PROGRAM: return scr_str_new("[object Object]", 15);
    default: break;
  }
  /* A host object's String(): its toString(). */
  ScrJsval *r = hi_call_method(v, "toString", 0, NULL);
  if (!r) return NULL;
  ScrStr *s = r->kind == SCR_HV_STRING ? scr_str_retain(r->str) : scr_str_new("[object Object]", 15);
  scr_jsval_release(r);
  return s;
}

/* A value as a static console.log prints it: strings as themselves, host objects as the host inspects them. +1. */
ScrStr *scr_jsval_inspect(ScrJsval *v) {
  hi_entry();
  if (v->kind != SCR_HV_OBJECT) return scr_jsval_to_str(v);
  ScrHostVal out = {0};
  ScrJsval *r = hi_result(hops->inspect(v->ref, &out), &out);
  if (!r) return NULL;
  ScrStr *s = scr_jsval_to_str(r);
  scr_jsval_release(r);
  return s;
}

/* ToNumber over the primitives the host island carries (StringToNumber exactly, through the runtime's). */
static double hi_number(const ScrJsval *v) {
  switch (v->kind) {
    case SCR_HV_NUMBER: return v->num;
    case SCR_HV_BOOL: return v->b ? 1 : 0;
    case SCR_HV_NULL: return 0;
    case SCR_HV_STRING: return scr_string_to_number(v->str);
    default: return NAN;
  }
}

ScrJsval *scr_jsval_neg(ScrJsval *a) {
  hi_entry();
  if (scr_jsval_is_object(a)) { hi_type_error("arithmetic on host objects is not supported"); return NULL; }
  return scr_jsval_from_f64(-hi_number(a));
}

ScrJsval *scr_jsval_plus(ScrJsval *a) {
  hi_entry();
  if (scr_jsval_is_object(a)) { hi_type_error("arithmetic on host objects is not supported"); return NULL; }
  return scr_jsval_from_f64(hi_number(a));
}

static bool hi_strict_equal(const ScrJsval *a, const ScrJsval *b) {
  if (a->kind != b->kind) return false;
  switch (a->kind) {
    case SCR_HV_UNDEFINED: case SCR_HV_NULL: return true;
    case SCR_HV_BOOL: return a->b == b->b;
    case SCR_HV_NUMBER: return a->num == b->num;
    case SCR_HV_STRING: return a->str->len == b->str->len && !memcmp(a->str->data, b->str->data, a->str->len);
    default: return a->ref == b->ref; /* the host keeps one reference per object (identity) */
  }
}

ScrJsval *scr_jsval_binop(int op, ScrJsval *a, ScrJsval *b) {
  hi_entry();
  if (op == SCR_JSOP_ADD && (a->kind == SCR_HV_STRING || b->kind == SCR_HV_STRING)) {
    ScrStr *x = scr_jsval_to_str(a);
    if (!x) return NULL;
    ScrStr *y = scr_jsval_to_str(b);
    if (!y) { scr_str_release(x); return NULL; }
    ScrStr *s = scr_str_alloc_raw(x->len + y->len, x->len + y->len + 1);
    memcpy(s->data, x->data, x->len);
    memcpy(s->data + x->len, y->data, y->len);
    s->len = x->len + y->len;
    s->data[s->len] = 0;
    scr_str_release(x);
    scr_str_release(y);
    return hi_str_cell(s);
  }
  if (scr_jsval_is_object(a) || scr_jsval_is_object(b)) { hi_type_error("arithmetic on host objects is not supported"); return NULL; }
  double x = hi_number(a), y = hi_number(b), r;
  switch (op) {
    case SCR_JSOP_ADD: r = x + y; break;
    case SCR_JSOP_SUB: r = x - y; break;
    case SCR_JSOP_MUL: r = x * y; break;
    case SCR_JSOP_DIV: r = x / y; break;
    case SCR_JSOP_MOD: r = fmod(x, y); break;
    case SCR_JSOP_POW: r = pow(x, y); break;
    default: hi_fail("unknown binary operator");
  }
  return scr_jsval_from_f64(r);
}

/* The next UTF-16 code unit of a UTF-8 (WTF-8) string: *i walks the bytes, *low holds the pending low surrogate of
 * an astral character. -1 at the end. */
static int hi_next_unit(const ScrStr *s, size_t *i, int *low) {
  if (*low >= 0) {
    int u = *low;
    *low = -1;
    return u;
  }
  if (*i >= s->len) return -1;
  const unsigned char *p = (const unsigned char *)s->data + *i;
  size_t n = hi_utf8_len(p[0]);
  if (*i + n > s->len) n = 1;
  uint32_t cp = n == 1 ? p[0] : n == 2 ? ((p[0] & 0x1Fu) << 6) | (p[1] & 0x3Fu)
              : n == 3 ? ((p[0] & 0x0Fu) << 12) | ((p[1] & 0x3Fu) << 6) | (p[2] & 0x3Fu)
                       : ((p[0] & 0x07u) << 18) | ((p[1] & 0x3Fu) << 12) | ((p[2] & 0x3Fu) << 6) | (p[3] & 0x3Fu);
  *i += n;
  if (cp < 0x10000) return (int)cp;
  cp -= 0x10000;
  *low = (int)(0xDC00 + (cp & 0x3FF));
  return (int)(0xD800 + (cp >> 10));
}

/* JavaScript's string order: code units of the UTF-16 forms, not UTF-8 bytes (they differ once an astral character
 * meets one in U+E000..U+FFFF). */
static int hi_str_compare(const ScrStr *a, const ScrStr *b) {
  size_t i = 0, j = 0;
  int la = -1, lb = -1;
  for (;;) {
    int x = hi_next_unit(a, &i, &la), y = hi_next_unit(b, &j, &lb);
    if (x != y) return x < y ? -1 : 1; /* the end (-1) sorts first */
    if (x < 0) return 0;
  }
}

int scr_jsval_cmp(int op, ScrJsval *a, ScrJsval *b) {
  hi_entry();
  if (op == SCR_JSOP_EQ) return hi_strict_equal(a, b);
  if (op == SCR_JSOP_NEQ) return !hi_strict_equal(a, b);
  if (a->kind == SCR_HV_STRING && b->kind == SCR_HV_STRING) {
    int c = hi_str_compare(a->str, b->str);
    return op == SCR_JSOP_LT ? c < 0 : op == SCR_JSOP_LE ? c <= 0 : op == SCR_JSOP_GT ? c > 0 : c >= 0;
  }
  if (scr_jsval_is_object(a) || scr_jsval_is_object(b)) { hi_type_error("comparison of host objects is not supported"); return -1; }
  double x = hi_number(a), y = hi_number(b);
  return op == SCR_JSOP_LT ? x < y : op == SCR_JSOP_LE ? x <= y : op == SCR_JSOP_GT ? x > y : x >= y;
}

/* ── JSON ────────────────────────────────────────────────────────────── */

/* SerializeJSONProperty over host values: 1 written, 0 nothing (undefined, functions: the caller omits the member or
 * writes null), -1 with the exception pending (a cycle, a throwing getter or toJSON). */
static int hi_json_put(ScrJsonBuf *b, ScrJsval *v, const ScrStr *key, bool to_json) {
  switch (v->kind) {
    case SCR_HV_UNDEFINED: case SCR_HV_CLOSURE: return 0;
    /* A compiled value: its own JSON (the runtime's writer over the value itself). */
    case SCR_HV_PROGRAM:
      scr_jb_put_dyn(b, hi_closure(v->ref)->dynfn);
      return scr_exc_pending() ? -1 : 1;
    case SCR_HV_NULL: scr_jb_puts(b, "null"); return 1;
    case SCR_HV_BOOL: scr_jb_puts(b, v->b ? "true" : "false"); return 1;
    case SCR_HV_NUMBER: scr_jb_put_f64(b, v->num); return 1;
    case SCR_HV_STRING: scr_jb_put_json_str(b, v->str); return 1;
    default: break;
  }
  if (hops->is_callable(v->ref)) return 0;
  if (to_json) {
    ScrJsval *fn = hi_get(v, "toJSON");
    if (!fn) return -1;
    if (hi_callable(fn)) {
      ScrJsval *k = key ? scr_jsval_from_str(key) : hi_str_cell(scr_str_new("", 0));
      ScrJsval *r = hi_call(fn, v->ref, 1, &k);
      scr_jsval_release(k);
      scr_jsval_release(fn);
      if (!r) return -1;
      int st = hi_json_put(b, r, key, false);
      scr_jsval_release(r);
      return st;
    }
    scr_jsval_release(fn);
  }
  bool array = hops->is_array(v->ref);
  if (!scr_jb_enter(b, (const void *)(uintptr_t)v->ref, array)) return -1;
  int st = 1;
  if (array) {
    ScrJsval *len = hi_get(v, "length");
    if (!len) { scr_jb_leave(b); return -1; }
    size_t n = len->kind == SCR_HV_NUMBER && len->num > 0 ? (size_t)len->num : 0;
    scr_jsval_release(len);
    scr_jb_putc(b, '[');
    for (size_t i = 0; i < n && st >= 0; i++) {
      if (i) scr_jb_putc(b, ',');
      char idx[24];
      int il = snprintf(idx, sizeof idx, "%zu", i);
      scr_jb_edge_idx(b, i);
      ScrJsval *e = hi_get(v, idx);
      ScrStr *ek = scr_str_new(idx, (size_t)il);
      int put = e ? hi_json_put(b, e, ek, true) : -1;
      scr_str_release(ek);
      scr_jsval_release(e);
      if (put == 0) scr_jb_puts(b, "null");
      if (put < 0) st = -1;
    }
    if (st >= 0) scr_jb_putc(b, ']');
  } else {
    size_t n = 0;
    ScrJsval **keys = hi_keys(v, &n);
    if (!keys) { scr_jb_leave(b); return -1; }
    scr_jb_putc(b, '{');
    bool first = true;
    for (size_t i = 0; i < n; i++) {
      if (st >= 0) {
        size_t mark = b->len;
        if (!first) scr_jb_putc(b, ',');
        scr_jb_put_json_str(b, keys[i]->str);
        scr_jb_putc(b, ':');
        scr_jb_edge_key(b, keys[i]->str);
        ScrJsval *e = scr_jsval_get_prop(v, keys[i]->str);
        int put = e ? hi_json_put(b, e, keys[i]->str, true) : -1;
        scr_jsval_release(e);
        if (put == 0) b->len = mark; /* an omitted member: drop its key */
        else if (put > 0) first = false;
        else st = -1;
      }
      scr_jsval_release(keys[i]);
    }
    free(keys);
    if (st >= 0) scr_jb_putc(b, '}');
  }
  scr_jb_leave(b);
  return st;
}

/* Composite exit: JSON.stringify of the host value, for the static side's json.parse + dynCheck pipeline. A value
 * JSON cannot represent at the top (undefined, a function) refuses. */
ScrStr *scr_jsval_to_json(ScrJsval *v) {
  hi_entry();
  ScrJsonBuf b;
  scr_jb_init(&b);
  int st = hi_json_put(&b, v, NULL, true);
  ScrStr *s = scr_jb_finish(&b);
  if (st > 0) return s;
  scr_str_release(s);
  if (st == 0) hi_exit_fail("a JSON-representable value", v);
  return NULL;
}

/* ── checked-dynamic values crossing in (from_dyn, from_json) ────────── */

/* The waiter's payload mode for a checked-dynamic promise (its payload is a dyn value): beside the SCR_ISLP_* tags. */
#define HI_PAYLOAD_DYN 100
static ScrJsval *hi_from_promise(ScrPromise *p, int payload, ScrJsval *(*conv)(void *));

/* scr_await_dyn lives in scr_async_dyn.c, linked whenever a program can make a dyn promise (the only way to reach
 * HI_PAYLOAD_DYN); this weak twin keeps the island linkable without it and never runs. */
__attribute__((weak)) ScrDyn *scr_await_dyn(ScrPromise *p) {
  (void)p;
  hi_fail("a checked-dynamic promise without the runtime's dyn promise unit");
}

static const char *hi_dyn_unmarshalable(ScrDynKind kind) {
  switch (kind) {
    case SCR_DYN_HANDLE: return "a runtime handle";
    case SCR_DYN_PROXY: return "a native Proxy";
    case SCR_DYN_BIGINT: return "a bigint";
    case SCR_DYN_SYMBOL: return "a symbol";
    default: return NULL;
  }
}

/* The dyn tree rebuilt as host values — a deep copy (the jsMarshal aliasing stance); a JSVAL node is its own cell (the
 * identity round trip) and a function crosses as a closure-table entry over its thunk. NULL pending. */
static ScrJsval *hi_from_dyn(const ScrDyn *d) {
  switch (d->kind) {
    case SCR_DYN_UNDEF: return scr_jsval_undefined();
    case SCR_DYN_NULL: return scr_jsval_null();
    case SCR_DYN_BOOL: return scr_jsval_from_bool(d->v.b);
    case SCR_DYN_NUM: return scr_jsval_from_f64(d->v.num);
    case SCR_DYN_STR: return scr_jsval_from_str(d->v.str);
    case SCR_DYN_BYTES: return scr_jsval_from_bytes(d->v.bytes);
    case SCR_DYN_JSVAL: return scr_jsval_retain(d->v.jsval.cell);
    /* A promise in checked-dynamic data (a `T | Promise<void>` callback result) crosses as a host promise settling
     * with its dyn payload. */
    case SCR_DYN_PROMISE: return hi_from_promise(scr_promise_retain(d->v.promise), HI_PAYLOAD_DYN, NULL);
    case SCR_DYN_FUNC: {
      ScrJsval *v = hi_cell(SCR_HV_CLOSURE);
      v->ref = hi_closure_add((HiClosure){.dynfn = scr_dyn_retain((ScrDyn *)d)});
      return v;
    }
    case SCR_DYN_TYPED_REF: {
      /* A class instance crosses by reference (as WasmGC hands the page the object itself): the host holds it
       * opaquely and it comes back as itself. Records and other static views cross as their snapshot. */
      if (d->v.typed_ref.type_key_len >= 7 && memcmp(d->v.typed_ref.type_key, "object:", 7) == 0)
        return scr_jsval_from_program((ScrDyn *)d);
      ScrDyn *view = scr_dyn_typed_ref_materialize(d);
      ScrJsval *v = hi_from_dyn(view);
      scr_dyn_release(view);
      return v;
    }
    /* A native handle (an ArrayBuffer in a postMessage transfer list) crosses by reference too, opaque to the host, and
     * comes back as itself. */
    case SCR_DYN_HANDLE: return scr_jsval_from_program((ScrDyn *)d);
    case SCR_DYN_ARR: {
      size_t n = d->v.arr.len;
      ScrJsval **cells = malloc((n ? n : 1) * sizeof *cells);
      if (!cells) hi_fail("out of memory");
      size_t built = 0;
      for (; built < n; built++) {
        const ScrDyn *item = d->v.arr.items[built];
        cells[built] = item ? hi_from_dyn(item) : scr_jsval_undefined(); /* a hole reads undefined */
        if (!cells[built]) break;
      }
      ScrJsval *arr = built == n ? hi_array_of((int)n, cells) : NULL;
      for (size_t i = 0; i < built; i++) scr_jsval_release(cells[i]);
      free(cells);
      return arr;
    }
    case SCR_DYN_OBJ: {
      ScrJsval *o = hi_new_object();
      for (size_t i = 0; i < d->v.obj.len; i++) {
        const ScrDynEntry *ent = &scr_dyn_obj_dict_entries(d)[i];
        ScrJsval *val = ent->value ? hi_from_dyn(ent->value) : scr_jsval_undefined();
        if (!val || !hi_set(o, ent->key, ent->key_len, val)) {
          scr_jsval_release(val);
          scr_jsval_release(o);
          return NULL;
        }
        scr_jsval_release(val);
      }
      return o;
    }
    default: {
      char msg[128];
      const char *bad = hi_dyn_unmarshalable(d->kind);
      snprintf(msg, sizeof msg, "an 'unknown' value holding %s cannot enter dynamically-executed code", bad ? bad : "this kind");
      hi_type_error(msg);
      return NULL;
    }
  }
}

ScrJsval *scr_jsval_from_dyn(const ScrDyn *d) {
  hi_entry();
  return hi_from_dyn(d);
}

/* A compiled value crossing by reference (a class instance entering the island: `window.x = service`): the host holds
 * it opaquely, and it comes back as itself. Borrows `d`. */
ScrJsval *scr_jsval_from_program(ScrDyn *d) {
  hi_entry();
  ScrJsval *v = hi_cell(SCR_HV_PROGRAM);
  v->ref = hi_closure_add((HiClosure){.dynfn = scr_dyn_retain(d)});
  return v;
}

/* The composite entry path: text from the emitted type-directed JSON serializers, parsed by the runtime's own JSON
 * parser and rebuilt as host values. */
ScrJsval *scr_jsval_from_json(const ScrStr *json) {
  hi_entry();
  ScrDyn *d = scr_json_parse((ScrStr *)json);
  if (!d) return NULL;
  ScrJsval *v = hi_from_dyn(d);
  scr_dyn_release(d);
  return v;
}

/* ── host values in the checked-dynamic tree (SCR_DYN_JSVAL) ─────────── */

static const ScrDynJsvalOps hi_dynjs_ops;

/* A cell (borrowed) as a dyn value: scalars normalize to the native kinds, everything else wraps by reference. */
static ScrDyn *hi_dyn_of(ScrJsval *v) {
  switch (v->kind) {
    case SCR_HV_UNDEFINED: return scr_dyn_retain(scr_dyn_undefined());
    case SCR_HV_NULL: return scr_dyn_new_null();
    case SCR_HV_BOOL: return scr_dyn_new_bool(v->b);
    case SCR_HV_NUMBER: return scr_dyn_new_num(v->num);
    case SCR_HV_STRING: return scr_dyn_new_str(v->str);
    /* A compiled value that crossed by reference: the same value again (identity). */
    case SCR_HV_PROGRAM: return scr_dyn_retain(hi_closure(v->ref)->dynfn);
    default: return scr_dyn_alloc_jsval(scr_jsval_retain(v), &hi_dynjs_ops);
  }
}

ScrDyn *scr_dyn_from_jsval(ScrJsval *cell) {
  hi_entry();
  return hi_dyn_of(cell);
}

/* A cell result (+1, consumed) as a dyn value; NULL passes through. */
static ScrDyn *hi_dyn_take(ScrJsval *v) {
  if (!v) return NULL;
  ScrDyn *d = hi_dyn_of(v);
  scr_jsval_release(v);
  return d;
}

/* A vector of cells (+1 each, consumed with the vector) as a native dyn array. */
static ScrDyn *hi_dyn_array_take(ScrJsval **cells, size_t n) {
  ScrDyn *out = scr_dyn_new_arr();
  for (size_t i = 0; i < n; i++) scr_dyn_arr_push(out, hi_dyn_take(cells[i]));
  free(cells);
  return out;
}

static void hi_dynjs_release(ScrJsval *cell) { scr_jsval_release(cell); }
static ScrStr *hi_dynjs_typeof(ScrJsval *cell) { return scr_jsval_typeof(cell); }
static bool hi_dynjs_truthy(ScrJsval *cell) { return scr_jsval_truthy(cell) != 0; }
static ScrStr *hi_dynjs_to_str(ScrJsval *cell) { return scr_jsval_to_str(cell); }
static bool hi_dynjs_strict_eq(ScrJsval *a, ScrJsval *b) { return hi_strict_equal(a, b); }
static bool hi_dynjs_is_array(ScrJsval *cell) { return cell->kind == SCR_HV_OBJECT && hops->is_array(cell->ref); }
static bool hi_dynjs_is_error(ScrJsval *cell) { return cell->kind == SCR_HV_OBJECT && hops->type_probe(cell->ref, "isNativeError", 13); }
static bool hi_dynjs_is_nullish(ScrJsval *cell) { return scr_jsval_is_nullish(cell); }

static ScrDyn *hi_dynjs_key_get(ScrJsval *cell, const ScrStr *k) { return hi_dyn_take(scr_jsval_get_prop(cell, k)); }

static bool hi_dynjs_key_set(ScrJsval *cell, const ScrStr *k, const ScrDyn *v) {
  ScrJsval *vj = scr_jsval_from_dyn(v);
  if (!vj) return false;
  int ok = scr_jsval_set_prop(cell, k, vj);
  scr_jsval_release(vj);
  return ok != 0;
}

/* dyn arguments as cells (+1 each), or false pending (the built ones released). */
static bool hi_dynjs_args_in(ScrDyn *const *args, size_t argc, ScrJsval **cells) {
  for (size_t i = 0; i < argc; i++) {
    cells[i] = scr_jsval_from_dyn(args[i]);
    if (!cells[i]) {
      for (size_t j = 0; j < i; j++) scr_jsval_release(cells[j]);
      return false;
    }
  }
  return true;
}

static ScrDyn *hi_dynjs_invoke_on(ScrJsval *fn, ScrHostRef receiver, ScrDyn *const *args, size_t argc) {
  ScrJsval *stack[HI_STACK_ARGS];
  ScrJsval **cells = argc <= HI_STACK_ARGS ? stack : malloc(argc * sizeof *cells);
  if (!cells) hi_fail("out of memory");
  ScrJsval *r = NULL;
  if (hi_dynjs_args_in(args, argc, cells)) {
    r = hi_call(fn, receiver, (int)argc, cells);
    for (size_t i = 0; i < argc; i++) scr_jsval_release(cells[i]);
  }
  if (cells != stack) free(cells);
  return hi_dyn_take(r);
}

static ScrDyn *hi_dynjs_call(ScrJsval *cell, ScrDyn *const *args, size_t argc) {
  ScrDyn *receiver = scr_dyn_this_get();
  ScrJsval *rc = scr_jsval_from_dyn(receiver);
  scr_dyn_release(receiver);
  if (!rc) return NULL;
  ScrDyn *r = hi_dynjs_invoke_on(cell, rc->kind == SCR_HV_OBJECT ? rc->ref : 0, args, argc);
  scr_jsval_release(rc);
  return r;
}

static ScrDyn *hi_dynjs_invoke(ScrJsval *cell, const char *method, ScrDyn *const *args, size_t argc, const char *what) {
  ScrJsval *fn = hi_get(cell, method);
  if (!fn) return NULL;
  if (!hi_callable(fn)) {
    scr_jsval_release(fn);
    char msg[256];
    snprintf(msg, sizeof msg, "%s is not a function", what);
    hi_type_error(msg);
    return NULL;
  }
  ScrDyn *r = hi_dynjs_invoke_on(fn, cell->kind == SCR_HV_OBJECT ? cell->ref : 0, args, argc);
  scr_jsval_release(fn);
  return r;
}

/* Object.keys / values / entries (mode 0/1/2) as a native dyn array. */
static ScrDyn *hi_dynjs_obj_walk(ScrJsval *cell, int mode) {
  if (cell->kind != SCR_HV_OBJECT) return scr_dyn_new_arr();
  size_t n = 0;
  ScrJsval **keys = hi_keys(cell, &n);
  if (!keys) return NULL;
  ScrDyn *out = scr_dyn_new_arr();
  bool ok = true;
  for (size_t i = 0; i < n; i++) {
    if (ok && mode == 0) scr_dyn_arr_push(out, hi_dyn_of(keys[i]));
    else if (ok) {
      ScrDyn *v = hi_dyn_take(scr_jsval_get_prop(cell, keys[i]->str));
      if (!v) ok = false;
      else if (mode == 1) scr_dyn_arr_push(out, v);
      else {
        ScrDyn *pair = scr_dyn_new_arr();
        scr_dyn_arr_push(pair, hi_dyn_of(keys[i]));
        scr_dyn_arr_push(pair, v);
        scr_dyn_arr_push(out, pair);
      }
    }
    scr_jsval_release(keys[i]);
  }
  free(keys);
  if (ok) return out;
  scr_dyn_release(out);
  return NULL;
}

static int hi_dynjs_has_own(ScrJsval *cell, const ScrStr *k) {
  return cell->kind == SCR_HV_OBJECT && hops->has_own(cell->ref, k->data, k->len);
}

/* `k in o`: an own property, or any member the host answers (its methods read as bound functions); a compiled value
 * held by reference answers as itself; a primitive is V8's TypeError. */
static int hi_dynjs_has(ScrJsval *cell, const ScrStr *k) {
  if (cell->kind == SCR_HV_PROGRAM) {
    bool in = scr_dyn_has_key(hi_closure(cell->ref)->dynfn, k);
    return scr_exc_pending() ? -1 : in;
  }
  if (cell->kind != SCR_HV_OBJECT && cell->kind != SCR_HV_CLOSURE) {
    char msg[256];
    snprintf(msg, sizeof msg, "Cannot use 'in' operator to search for '%.*s' in a primitive", (int)k->len, k->data);
    hi_type_error(msg);
    return -1;
  }
  if (cell->kind == SCR_HV_CLOSURE) return 0;
  if (hops->has_own(cell->ref, k->data, k->len)) return 1;
  ScrJsval *v = scr_jsval_get_prop(cell, k);
  if (!v) return -1;
  int present = v->kind != SCR_HV_UNDEFINED;
  scr_jsval_release(v);
  return present;
}

/* A host object keys a weak collection by its ref (refs are small integers, never a runtime pointer): the host
 * reports its death through scr_host_object_disposed. A compiled value held by reference keys as itself; a closure id
 * has no death report. */
static int hi_dynjs_weak_key(ScrJsval *cell, void **identity, const ScrDyn **program) {
  if (cell->kind == SCR_HV_PROGRAM) { *identity = NULL; *program = hi_closure(cell->ref)->dynfn; return 1; }
  if (cell->kind != SCR_HV_OBJECT) return -1;
  *identity = (void *)(uintptr_t)cell->ref;
  return 1;
}

/* A host typed array's elements, copied (the boundary's aliasing stance, as scr_jsval_exit_bytes). */
static ScrBytes *hi_dynjs_bytes_copy(ScrJsval *cell) {
  uint32_t elem = 0;
  const uint8_t *data = NULL;
  size_t n = 0;
  if (cell->kind != SCR_HV_OBJECT || !hops->bytes_view(cell->ref, &elem, &data, &n)) return NULL;
  size_t size = scr_bytes_elem_size((ScrBytesElem)elem);
  ScrBytes *b = scr_bytes_new((ScrBytesElem)elem, (double)(n / size));
  if (n > 0) memcpy(b->data, data, n);
  return b;
}

void scr_host_object_disposed(ScrHostRef obj) {
  scr_weak_dispose((void *)(uintptr_t)obj);
}

static bool hi_dynjs_assign(ScrJsval *cell, const ScrDyn *src) {
  ScrJsval *sj = scr_jsval_from_dyn(src);
  if (!sj) return false;
  ScrJsval *r = scr_jsval_obj_spread(cell, sj);
  scr_jsval_release(sj);
  scr_jsval_release(r);
  return r != NULL;
}

static ScrStr *hi_dynjs_to_json(ScrJsval *cell) { return scr_jsval_to_json(cell); }

static ScrDyn *hi_dynjs_iter_drain(ScrJsval *cell, bool spread, const ScrStr *spell) {
  static SCR_TL const ScrStr *spread_text;
  if (!spread_text) {
    static const char t[] = "Spread syntax requires ...iterable[Symbol.iterator] to be a function";
    spread_text = scr_str_new(t, sizeof t - 1);
  }
  size_t n = 0;
  ScrJsval **cells = hi_drain(cell, spread ? spread_text : spell, &n);
  return cells ? hi_dyn_array_take(cells, n) : NULL;
}

static ScrDyn *hi_dynjs_iterator(ScrJsval *cell, const ScrStr *spell, bool array_from) {
  (void)array_from; /* Array.from over an array-like is the iterator of its elements here too */
  return hi_dyn_take(hi_iterator(cell, spell));
}

static ScrDyn *hi_dynjs_iter_n(ScrJsval *cell, double count) {
  ScrJsval *prefix = scr_jsval_iter_n(cell, count);
  if (!prefix) return NULL;
  size_t n = count > 0 ? (size_t)count : 0;
  ScrJsval **cells = malloc((n ? n : 1) * sizeof *cells);
  if (!cells) hi_fail("out of memory");
  for (size_t i = 0; i < n; i++) {
    char idx[24];
    snprintf(idx, sizeof idx, "%zu", i);
    cells[i] = hi_get(prefix, idx);
    if (!cells[i]) hi_fail("the host lost an iteration prefix");
  }
  scr_jsval_release(prefix);
  return hi_dyn_array_take(cells, n);
}

static bool hi_dynjs_type_probe(ScrJsval *cell, const ScrStr *probe) {
  return cell->kind == SCR_HV_OBJECT && hops->type_probe(cell->ref, probe->data, probe->len);
}

static const ScrDynJsvalOps hi_dynjs_ops = {
  hi_dynjs_release,
  hi_dynjs_typeof,
  hi_dynjs_truthy,
  hi_dynjs_to_str,
  hi_dynjs_strict_eq,
  hi_dynjs_is_array,
  hi_dynjs_is_error,
  hi_dynjs_key_get,
  hi_dynjs_key_set,
  hi_dynjs_call,
  hi_dynjs_invoke,
  hi_dynjs_is_nullish,
  hi_dynjs_obj_walk,
  hi_dynjs_has_own,
  hi_dynjs_assign,
  hi_dynjs_to_json,
  hi_dynjs_iter_drain,
  hi_dynjs_iterator,
  hi_dynjs_iter_n,
  hi_dynjs_type_probe,
  hi_dynjs_has,
  hi_dynjs_weak_key,
  hi_dynjs_bytes_copy,
};

/* ── promises ────────────────────────────────────────────────────────── */

/* A scriptc promise crossing out (an async callback's result): a host promise a waiter fiber settles once the
 * scriptc one does — fulfillment marshals per payload tag (or through `conv`, an emitted converter that takes the
 * +1 payload), rejection crosses the reason (errors as host Error objects). */
typedef struct {
  ScrPromise *p;
  ScrHostRef target; /* the host promise, one count held */
  int payload;       /* SCR_ISLP_*; ignored when conv is set */
  ScrJsval *(*conv)(void *payload);
} HiPromWrap;

static void hi_prom_wrap_entry(ScrFiber *self, void *arg) {
  (void)self;
  HiPromWrap *w = (HiPromWrap *)arg;
  ScrJsval *v = NULL;
  if (w->conv) {
    void *payload = scr_await_ref(w->p);
    if (!scr_exc_pending()) v = w->conv(payload);
  } else {
    switch (w->payload) {
      case SCR_ISLP_F64: { double f = scr_await_f64(w->p); if (!scr_exc_pending()) v = scr_jsval_from_f64(f); break; }
      case SCR_ISLP_BOOL: { bool b = scr_await_bool(w->p); if (!scr_exc_pending()) v = scr_jsval_from_bool(b); break; }
      case SCR_ISLP_STR: {
        ScrStr *s = scr_await_str(w->p);
        if (!scr_exc_pending()) v = s ? hi_str_cell(s) : scr_jsval_undefined();
        else scr_str_release(s);
        break;
      }
      case SCR_ISLP_JSVAL: {
        ScrJsval *j = (ScrJsval *)scr_await_ref(w->p);
        if (!scr_exc_pending()) v = j ? j : scr_jsval_undefined();
        break;
      }
      case SCR_ISLP_JSVAL_ARR: {
        ScrArr *ja = (ScrArr *)scr_await_ref(w->p);
        if (!scr_exc_pending() && ja) {
          ScrJsval **cells = malloc((ja->len ? ja->len : 1) * sizeof *cells);
          if (!cells) hi_fail("out of memory");
          for (size_t i = 0; i < ja->len; i++) cells[i] = (ScrJsval *)scr_arr_get_ref(ja, (double)i);
          v = hi_array_of((int)ja->len, cells);
          for (size_t i = 0; i < ja->len; i++) scr_jsval_release(cells[i]);
          free(cells);
        } else if (!scr_exc_pending()) {
          v = scr_jsval_undefined();
        }
        if (ja) scr_arr_release(ja);
        break;
      }
      case HI_PAYLOAD_DYN: {
        ScrDyn *d = scr_await_dyn(w->p);
        if (d) {
          v = scr_jsval_from_dyn(d);
          scr_dyn_release(d);
        }
        break;
      }
      default: scr_await_void(w->p); if (!scr_exc_pending()) v = scr_jsval_undefined(); break;
    }
  }
  hi_entry();
  bool rejected = v == NULL;
  if (rejected) v = hi_take_pending();
  ScrHostVal value = hi_view(v);
  hops->settle_promise(w->target, rejected, &value);
  scr_jsval_release(v);
  hops->release(w->target);
  scr_promise_release(w->p);
  free(w);
}

static ScrJsval *hi_from_promise(ScrPromise *p, int payload, ScrJsval *(*conv)(void *)) {
  hi_entry();
  ScrHostVal out = {0};
  if (hops->new_promise(&out) != SCR_HOST_OK) hi_fail("the host could not make a promise");
  ScrJsval *cell = hi_adopt(&out);
  HiPromWrap *w = malloc(sizeof *w);
  if (!w) hi_fail("out of memory");
  *w = (HiPromWrap){.p = p, .target = cell->ref, .payload = payload, .conv = conv};
  hops->retain(cell->ref);
  ScrPromise *waiter = scr_async_spawn_after(p, hi_prom_wrap_entry, w);
  scr_promise_release(waiter); /* the waiter never rejects; nobody awaits it */
  return cell;
}

ScrJsval *scr_jsval_from_promise(ScrPromise *p, int payload) { return hi_from_promise(p, payload, NULL); }

/* The typed-adapter form for payloads without a tag (a record, bytes): `conv` takes the +1 payload and answers the
 * host value (+1), or NULL with the exception pending (the host promise then rejects with it). */
ScrJsval *scr_jsval_from_promise_conv(ScrPromise *p, ScrJsval *(*conv)(void *payload)) { return hi_from_promise(p, 0, conv); }

/* A host promise (or any host value) awaited by compiled code: a fresh scriptc promise settled when the host's does,
 * fulfilling per payload tag; a non-promise value fulfills at once, as `await` treats it. */
typedef struct {
  ScrPromise *p; /* +1 */
  int payload;
} HiBridge;

static void hi_bridge_fulfill(HiBridge *b, ScrJsval *v) {
  switch (b->payload) {
    case SCR_ISLP_F64: { double f = 0; if (scr_jsval_exit_f64(v, &f)) scr_promise_fulfill_f64(b->p, f); break; }
    case SCR_ISLP_BOOL: { bool x = false; if (scr_jsval_exit_bool(v, &x)) scr_promise_fulfill_bool(b->p, x); break; }
    case SCR_ISLP_STR: { ScrStr *s = scr_jsval_exit_str(v); if (s) scr_promise_fulfill_str(b->p, s); break; }
    case SCR_ISLP_JSVAL: scr_promise_fulfill_ref(b->p, scr_jsval_retain(v), scr_jsval_retain_v, scr_jsval_release_v, NULL); break;
    case SCR_ISLP_JSVAL_ARR: {
      ScrArr *arr = scr_jsval_exit_jsval_arr(v);
      if (arr) scr_promise_fulfill_ref(b->p, arr, scr_arr_retain_v, scr_arr_release_v, NULL);
      break;
    }
    default: scr_promise_fulfill_void(b->p); break;
  }
  /* A lying fulfillment (the wrong kind for the declared payload) rejects with the boundary TypeError. */
  if (scr_exc_pending()) scr_promise_reject_pending(b->p);
}

static void hi_bridge_settled(void *ctx, int rejected, const ScrHostVal *value) {
  HiBridge *b = (HiBridge *)ctx;
  ScrJsval *v = hi_borrow(value);
  if (rejected) {
    hi_throw_value(v);
    scr_promise_reject_pending(b->p);
  } else {
    hi_bridge_fulfill(b, v);
  }
  scr_jsval_release(v);
  scr_promise_release(b->p);
  free(b);
}

ScrPromise *scr_jsval_bridge_promise(ScrJsval *v, int payload) {
  hi_entry();
  ScrPromise *p = scr_promise_new();
  HiBridge *b = malloc(sizeof *b);
  if (!b) hi_fail("out of memory");
  *b = (HiBridge){.p = scr_promise_retain(p), .payload = payload};
  if (v->kind == SCR_HV_OBJECT && hops->promise_subscribe(v->ref, hi_bridge_settled, b)) return p;
  hi_bridge_fulfill(b, v);
  scr_promise_release(b->p);
  free(b);
  return p;
}

/* ── typed host modules (host.call) ──────────────────────────────────── */

/* `fn(args)` for a function imported from a typed host module (`import { fetchText } from "host:fetch"`): one
 * host call; the compiled side converts the result to the declared type. +1, or NULL pending. */
ScrJsval *scr_host_module_call(const ScrStr *module, const ScrStr *name, int argc, ScrJsval **argv) {
  hi_entry();
  ScrHostVal stack[HI_STACK_ARGS], out = {0};
  ScrHostVal *a = hi_views(argc, argv, stack);
  int st = hops->module_call(module->data, module->len, name->data, name->len, argc, a, &out);
  if (a != stack) free(a);
  return hi_result(st, &out);
}
