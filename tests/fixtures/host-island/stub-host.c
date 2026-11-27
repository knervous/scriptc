/* A stub host for the host island's link tests (tests/harness/host-island.test.ts): a scr_host_ops() vtable small
 * enough to read, standing in for the generic host until it lands. It answers one typed host module, `host:demo`
 * (add, greet, fail), one global (`hostGreeting`), and the page's `console.log`, which a browser program reaches as a
 * page global. Every other operation throws, which the island turns into a catchable TypeError. Not a host
 * implementation: two fixed objects, no promises, no event loop work. */
#include <stdbool.h>
#include <stdio.h>
#include <string.h>
#include "scr_host_island.h"

static char greeting[256];

/* The two host objects: the console, and its log function. */
enum { CONSOLE = 1, CONSOLE_LOG = 2 };

static void print_value(const ScrHostVal *v) {
  switch (v->kind) {
    case SCR_HV_UNDEFINED: fputs("undefined", stdout); break;
    case SCR_HV_NULL: fputs("null", stdout); break;
    case SCR_HV_BOOL: fputs(v->flag ? "true" : "false", stdout); break;
    case SCR_HV_NUMBER:
      if (v->number == (double)(long long)v->number && v->number > -1e15 && v->number < 1e15) printf("%lld", (long long)v->number);
      else printf("%.17g", v->number);
      break;
    case SCR_HV_STRING: fwrite(v->str, 1, v->len, stdout); break;
    default: fputs("[object]", stdout); break;
  }
}

static int console_log(int argc, const ScrHostVal *argv, ScrHostVal *out) {
  for (int i = 0; i < argc; i++) {
    if (i) fputc(' ', stdout);
    print_value(&argv[i]);
  }
  fputc('\n', stdout);
  fflush(stdout);
  out->kind = SCR_HV_UNDEFINED;
  return SCR_HOST_OK;
}

static int threw(ScrHostVal *out, const char *message) {
  out->kind = SCR_HV_STRING;
  out->str = message;
  out->len = strlen(message);
  return SCR_HOST_THREW;
}

static int unsupported(ScrHostVal *out) { return threw(out, "the stub host does not implement this operation"); }

static bool named(const char *s, size_t len, const char *want) { return len == strlen(want) && memcmp(s, want, len) == 0; }

static int global_get(const char *name, size_t len, ScrHostVal *out) {
  if (named(name, len, "hostGreeting")) {
    out->kind = SCR_HV_STRING;
    out->str = "hello from the stub host";
    out->len = strlen(out->str);
    return SCR_HOST_OK;
  }
  if (named(name, len, "console")) {
    out->kind = SCR_HV_OBJECT;
    out->ref = CONSOLE;
    return SCR_HOST_OK;
  }
  out->kind = SCR_HV_UNDEFINED;
  return SCR_HOST_OK;
}

static int get_prop(ScrHostRef o, const char *n, size_t l, ScrHostVal *out) {
  if (o == CONSOLE && named(n, l, "log")) {
    out->kind = SCR_HV_OBJECT;
    out->ref = CONSOLE_LOG;
    return SCR_HOST_OK;
  }
  out->kind = SCR_HV_UNDEFINED;
  return SCR_HOST_OK;
}
static int set_prop(ScrHostRef o, const char *n, size_t l, const ScrHostVal *v, ScrHostVal *out) { (void)o; (void)n; (void)l; (void)v; return unsupported(out); }
static int call(ScrHostRef f, ScrHostRef t, int c, const ScrHostVal *a, ScrHostVal *out) {
  (void)t;
  if (f == CONSOLE_LOG) return console_log(c, a, out);
  return unsupported(out);
}
static int call_method(ScrHostRef o, const char *n, size_t l, int c, const ScrHostVal *a, ScrHostVal *out) {
  if (o == CONSOLE && named(n, l, "log")) return console_log(c, a, out);
  return unsupported(out);
}
static int construct(ScrHostRef f, int c, const ScrHostVal *a, ScrHostVal *out) { (void)f; (void)c; (void)a; return unsupported(out); }
static int instance_of(ScrHostRef o, ScrHostRef c) { (void)o; (void)c; return 0; }
static int is_callable(ScrHostRef o) { return o == CONSOLE_LOG; }
static void retain(ScrHostRef o) { (void)o; }
static void release(ScrHostRef o) { (void)o; }
static bool io_pending(void) { return false; }
static void io_poll(double ms) { (void)ms; }
static int new_object(ScrHostVal *out) { return unsupported(out); }
static int new_array(int c, const ScrHostVal *a, ScrHostVal *out) { (void)c; (void)a; return unsupported(out); }
static int is_array(ScrHostRef o) { (void)o; return 0; }
static int own_keys(ScrHostRef o, ScrHostVal *out) { (void)o; return unsupported(out); }
static int has_own(ScrHostRef o, const char *n, size_t l) { (void)o; (void)n; (void)l; return 0; }
static int define_getter(ScrHostRef o, const char *n, size_t l, const ScrHostVal *g, ScrHostVal *out) { (void)o; (void)n; (void)l; (void)g; return unsupported(out); }
static int get_iterator(ScrHostRef o, ScrHostVal *out) { (void)o; return unsupported(out); }
static int new_bytes(uint32_t e, const uint8_t *d, size_t l, ScrHostVal *out) { (void)e; (void)d; (void)l; return unsupported(out); }
static int bytes_view(ScrHostRef o, uint32_t *e, const uint8_t **d, size_t *l) { (void)o; (void)e; (void)d; (void)l; return 0; }
static int new_error(const char *n, size_t nl, const char *m, size_t ml, ScrHostVal *out) { (void)n; (void)nl; (void)m; (void)ml; return unsupported(out); }
static int new_promise(ScrHostVal *out) { return unsupported(out); }
static void settle_promise(ScrHostRef p, int r, const ScrHostVal *v) { (void)p; (void)r; (void)v; }
static int promise_subscribe(ScrHostRef o, ScrHostSettled s, void *c) { (void)o; (void)s; (void)c; return 0; }
static int type_probe(ScrHostRef o, const char *p, size_t l) { (void)o; (void)p; (void)l; return 0; }
static int inspect(ScrHostRef o, ScrHostVal *out) { (void)o; return unsupported(out); }
static int new_bytes_owned(uint32_t e, const uint8_t *d, size_t l, uint8_t *s, void *w, ScrHostVal *out) { (void)e; (void)d; (void)l; (void)s; (void)w; return unsupported(out); }

static int module_call(const char *module, size_t module_len, const char *name, size_t name_len, int argc,
                       const ScrHostVal *argv, ScrHostVal *out) {
  if (!named(module, module_len, "host:demo") && !named(module, module_len, "demo")) return unsupported(out);
  if (named(name, name_len, "add") && argc == 2 && argv[0].kind == SCR_HV_NUMBER && argv[1].kind == SCR_HV_NUMBER) {
    out->kind = SCR_HV_NUMBER;
    out->number = argv[0].number + argv[1].number;
    return SCR_HOST_OK;
  }
  if (named(name, name_len, "greet") && argc == 1 && argv[0].kind == SCR_HV_STRING) {
    int n = snprintf(greeting, sizeof greeting, "hello, %.*s", (int)argv[0].len, argv[0].str);
    out->kind = SCR_HV_STRING;
    out->str = greeting;
    out->len = n < 0 ? 0 : (size_t)n < sizeof greeting ? (size_t)n : sizeof greeting - 1;
    return SCR_HOST_OK;
  }
  if (named(name, name_len, "fail")) return threw(out, "the stub host refused");
  return unsupported(out);
}

static const ScrHostOps ops = {
  .abi = SCR_HOST_ABI,
  .global_get = global_get,
  .get_prop = get_prop,
  .set_prop = set_prop,
  .call = call,
  .call_method = call_method,
  .construct = construct,
  .instance_of = instance_of,
  .is_callable = is_callable,
  .retain = retain,
  .release = release,
  .io_pending = io_pending,
  .io_poll = io_poll,
  .new_object = new_object,
  .new_array = new_array,
  .is_array = is_array,
  .own_keys = own_keys,
  .has_own = has_own,
  .define_getter = define_getter,
  .get_iterator = get_iterator,
  .new_bytes = new_bytes,
  .bytes_view = bytes_view,
  .new_error = new_error,
  .new_promise = new_promise,
  .settle_promise = settle_promise,
  .promise_subscribe = promise_subscribe,
  .module_call = module_call,
  .type_probe = type_probe,
  .inspect = inspect,
  .new_bytes_owned = new_bytes_owned,
};

const ScrHostOps *scr_host_ops(void) { return &ops; }
