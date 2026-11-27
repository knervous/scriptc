// This file was modified from scriptc (Apache-2.0); see MODIFICATIONS.md.
#include "scr_runtime.h"

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
#include <windows.h>
#elif defined(__wasi__)
/* Native FFI is rejected for WASI. This keeps direct runtime builds honest. */
#else
#include <fcntl.h>
#include <pthread.h>
#include <unistd.h>
#endif

typedef enum {
  SCR_FFI_ARG_NONE = 0,
  SCR_FFI_ARG_F64,
  SCR_FFI_ARG_BOOL,
  SCR_FFI_ARG_U8,
  SCR_FFI_ARG_U32,
  SCR_FFI_ARG_I32,
  SCR_FFI_ARG_DATA,
} ScrFfiArgKind;

typedef struct {
  ScrFfiArgKind kind;
  union {
    double f64;
    uint32_t u32;
    int32_t i32;
    struct {
      uint8_t *data;
      size_t len;
    } span;
  } value;
} ScrFfiArg;

struct ScrFfiCall {
  ScrFfiTable *table;       /* opaque on the posting thread; NULL for a C task */
  void (*task)(void *);     /* a C task (scr_remote_post): run with task_arg on the owning thread */
  void *task_arg;
  void *loop;               /* reserved instance/loop identity */
  ScrClosure *callback;     /* opaque; the table owns its script RC pin */
  ScrFfiDispatchFn dispatch;
  size_t nargs;
  ScrFfiArg *args;
  struct ScrFfiCall *next;
};

/* One queue per runtime instance (one per thread under SCR_THREAD_INSTANCES,
 * the process's one otherwise). A foreign descriptor records its owner's queue
 * in table->loop when the script thread registers a callback; a foreign thread
 * posts through that pointer, never through thread-local state, so a call
 * lands on the instance that owns the callback. One process lock guards every
 * queue and every table's registration fields. */
typedef struct ScrFfiQueue {
  ScrFfiCall *head;
  ScrFfiCall *tail;
  size_t foreign_registrations;
  size_t holds;             /* scr_remote_hold: owner-thread liveness (pending async waits) */
  void (*wake)(void *);     /* scr_remote_set_wake: an embedder's loop doorbell, besides the pipe */
  void *wake_ctx;
  bool installed;
  bool stopping;
  int wake_pipe[2];
} ScrFfiQueue;

static SCR_TL ScrFfiQueue scr_ffi_queue_cell;
static SCR_TL bool scr_ffi_queue_ready;

/* The calling instance's queue (script thread only). */
static ScrFfiQueue *scr_ffi_queue(void) {
  ScrFfiQueue *q = &scr_ffi_queue_cell;
  if (!scr_ffi_queue_ready) {
    scr_ffi_queue_ready = true;
    q->wake_pipe[0] = q->wake_pipe[1] = -1;
  }
  return q;
}

#ifdef _WIN32
static SRWLOCK scr_ffi_lock = SRWLOCK_INIT;
static void scr_ffi_lock_enter(void) { AcquireSRWLockExclusive(&scr_ffi_lock); }
static void scr_ffi_lock_leave(void) { ReleaseSRWLockExclusive(&scr_ffi_lock); }
#elif defined(__wasi__)
static void scr_ffi_lock_enter(void) {}
static void scr_ffi_lock_leave(void) {}
#else
static pthread_mutex_t scr_ffi_lock = PTHREAD_MUTEX_INITIALIZER;
static void scr_ffi_lock_enter(void) { (void)pthread_mutex_lock(&scr_ffi_lock); }
static void scr_ffi_lock_leave(void) { (void)pthread_mutex_unlock(&scr_ffi_lock); }
#endif

static void scr_ffi_oom(void) { scr_trap("scriptc: out of memory\n"); }

/* Foreign trampolines cannot enter the script exception machinery. Allocation
 * failure and malformed native pointers are fatal process-boundary failures,
 * reported without touching any runtime object. */
static void scr_ffi_foreign_fatal(const char *message) {
  fputs(message, stderr);
  abort();
}

static void *scr_ffi_foreign_alloc(size_t size) {
  void *ptr = malloc(size == 0 ? 1 : size);
  if (ptr == NULL) scr_ffi_foreign_fatal("scriptc: out of memory\n");
  return ptr;
}

static void scr_ffi_call_free(ScrFfiCall *call) {
  if (call == NULL) return;
  for (size_t i = 0; i < call->nargs; i++) {
    if (call->args[i].kind == SCR_FFI_ARG_DATA) free(call->args[i].value.span.data);
  }
  free(call->args);
  free(call);
}

static bool scr_ffi_table_contains(const ScrFfiTable *table, const ScrClosure *callback) {
  for (size_t i = 0; i < table->len; i++) {
    if (table->entries[i] == callback) return true;
  }
  return false;
}

static void scr_ffi_table_retire(ScrFfiTable *table, ScrClosure *callback) {
  if (table->retired_len == table->retired_cap) {
    size_t cap = table->retired_cap == 0 ? 4 : table->retired_cap * 2;
    if (cap < table->retired_cap || cap > SIZE_MAX / sizeof *table->retired) scr_ffi_oom();
    ScrClosure **retired = realloc(table->retired, cap * sizeof *retired);
    if (retired == NULL) scr_ffi_oom();
    table->retired = retired;
    table->retired_cap = cap;
  }
  table->retired[table->retired_len++] = callback;
}

static void scr_ffi_release_retired(ScrFfiTable *table) {
  ScrClosure **retired = NULL;
  size_t len = 0;
  scr_ffi_lock_enter();
  if (table->queued == 0 && table->retired_len > 0) {
    retired = table->retired;
    len = table->retired_len;
    table->retired = NULL;
    table->retired_len = 0;
    table->retired_cap = 0;
  }
  scr_ffi_lock_leave();
  for (size_t i = 0; i < len; i++) scr_closure_release(retired[i]);
  free(retired);
}

void scr_ffi_retain_foreign(ScrFfiTable *table, ScrClosure *callback) {
  table->teardown = &scr_ffi_teardown_foreign;
  scr_ffi_link(table);
  scr_ffi_lock_enter();
  if (table->len == table->cap) {
    size_t cap = table->cap == 0 ? 4 : table->cap * 2;
    if (cap < table->cap || cap > SIZE_MAX / sizeof *table->entries) scr_ffi_oom();
    ScrClosure **entries = realloc(table->entries, cap * sizeof *entries);
    if (entries == NULL) scr_ffi_oom();
    table->entries = entries;
    table->cap = cap;
  }
  table->entries[table->len++] = scr_closure_retain(callback);
  ScrFfiQueue *q = scr_ffi_queue();
  table->loop = q;
  q->foreign_registrations++;
  scr_ffi_lock_leave();
}

void scr_ffi_require_foreign(ScrFfiTable *table, ScrClosure *callback) {
  scr_ffi_lock_enter();
  bool found = scr_ffi_table_contains(table, callback);
  scr_ffi_lock_leave();
  if (!found) scr_trap("scriptc: releasing a native callback registration that does not exist\n");
}

void scr_ffi_release_foreign(ScrFfiTable *table, ScrClosure *callback) {
  scr_ffi_lock_enter();
  for (size_t i = 0; i < table->len; i++) {
    if (table->entries[i] != callback) continue;
    ScrClosure *owned = table->entries[i];
    table->len--;
    if (i != table->len) table->entries[i] = table->entries[table->len];
    ScrFfiQueue *owner = table->loop;
    if (owner != NULL && owner->foreign_registrations > 0) owner->foreign_registrations--;
    bool deferred = table->queued > 0;
    if (deferred) scr_ffi_table_retire(table, owned);
    scr_ffi_lock_leave();
    if (!deferred) scr_closure_release(owned);
    return;
  }
  scr_ffi_lock_leave();
  scr_trap("scriptc: releasing a native callback registration that does not exist\n");
}

ScrFfiCall *scr_ffi_call_new(ScrFfiTable *table, ScrClosure *callback,
                             ScrFfiDispatchFn dispatch, size_t nargs) {
  ScrFfiCall *call = scr_ffi_foreign_alloc(sizeof *call);
  call->table = table;
  call->task = NULL;
  call->task_arg = NULL;
  call->loop = table->loop;
  call->callback = callback;
  call->dispatch = dispatch;
  call->nargs = nargs;
  call->args = nargs == 0 ? NULL : scr_ffi_foreign_alloc(nargs * sizeof *call->args);
  if (nargs > 0) memset(call->args, 0, nargs * sizeof *call->args);
  call->next = NULL;
  return call;
}

static ScrFfiArg *scr_ffi_call_arg(ScrFfiCall *call, size_t index) {
  if (index >= call->nargs) scr_ffi_foreign_fatal("scriptc: invalid staged FFI callback argument\n");
  return &call->args[index];
}

void scr_ffi_call_set_f64(ScrFfiCall *call, size_t i, double v) {
  ScrFfiArg *arg = scr_ffi_call_arg(call, i); arg->kind = SCR_FFI_ARG_F64; arg->value.f64 = v;
}
void scr_ffi_call_set_bool(ScrFfiCall *call, size_t i, uint8_t v) {
  ScrFfiArg *arg = scr_ffi_call_arg(call, i); arg->kind = SCR_FFI_ARG_BOOL; arg->value.u32 = v != 0;
}
void scr_ffi_call_set_u8(ScrFfiCall *call, size_t i, uint8_t v) {
  ScrFfiArg *arg = scr_ffi_call_arg(call, i); arg->kind = SCR_FFI_ARG_U8; arg->value.u32 = v;
}
void scr_ffi_call_set_u32(ScrFfiCall *call, size_t i, uint32_t v) {
  ScrFfiArg *arg = scr_ffi_call_arg(call, i); arg->kind = SCR_FFI_ARG_U32; arg->value.u32 = v;
}
void scr_ffi_call_set_i32(ScrFfiCall *call, size_t i, int32_t v) {
  ScrFfiArg *arg = scr_ffi_call_arg(call, i); arg->kind = SCR_FFI_ARG_I32; arg->value.i32 = v;
}

static void scr_ffi_call_copy_data(ScrFfiCall *call, size_t i,
                                   const uint8_t *v, size_t len,
                                   const char *null_message) {
  if (v == NULL && len != 0) scr_ffi_foreign_fatal(null_message);
  ScrFfiArg *arg = scr_ffi_call_arg(call, i);
  arg->kind = SCR_FFI_ARG_DATA;
  arg->value.span.len = len;
  arg->value.span.data = len == 0 ? NULL : scr_ffi_foreign_alloc(len);
  if (len > 0) memcpy(arg->value.span.data, v, len);
}

void scr_ffi_call_copy_string(ScrFfiCall *call, size_t i,
                              const uint8_t *v, size_t len) {
  scr_ffi_call_copy_data(call, i, v, len,
      "scriptc: native callback passed a NULL string span with nonzero length\n");
}

void scr_ffi_call_copy_bytes(ScrFfiCall *call, size_t i,
                             const uint8_t *v, size_t len) {
  scr_ffi_call_copy_data(call, i, v, len,
      "scriptc: native callback passed a NULL bytes span with nonzero length\n");
}

void scr_ffi_call_copy_cstring(ScrFfiCall *call, size_t i, const char *v) {
  if (v == NULL) scr_ffi_foreign_fatal("scriptc: native callback passed a NULL cstring\n");
  scr_ffi_call_copy_data(call, i, (const uint8_t *)v, strlen(v),
                         "scriptc: native callback passed a NULL cstring\n");
}

/* Appends to a queue and rings its pipe (the queue lock held). */
static void scr_ffi_enqueue_locked(ScrFfiQueue *q, ScrFfiCall *call) {
  if (q->tail != NULL) q->tail->next = call;
  else q->head = call;
  q->tail = call;
#if !defined(_WIN32) && !defined(__wasi__)
  if (q->wake_pipe[1] >= 0) {
    ssize_t ignored = write(q->wake_pipe[1], "f", 1);
    (void)ignored; /* a full pipe is already readable */
  }
#endif
}

void scr_ffi_post(ScrFfiCall *call) {
  scr_ffi_lock_enter();
  ScrFfiQueue *q = call->loop;
  if (q == NULL || q->stopping || !scr_ffi_table_contains(call->table, call->callback)) {
    scr_ffi_lock_leave();
    scr_ffi_call_free(call);
    return;
  }
  call->table->queued++;
  scr_ffi_enqueue_locked(q, call);
  void (*wake)(void *) = q->wake;
  void *wake_ctx = q->wake_ctx;
  scr_ffi_lock_leave();
  if (wake != NULL) wake(wake_ctx);
}

static const ScrFfiArg *scr_ffi_get_arg(const ScrFfiCall *call, size_t index) {
  if (index >= call->nargs) scr_trap("scriptc: invalid staged FFI callback argument\n");
  return &call->args[index];
}

double scr_ffi_call_get_f64(const ScrFfiCall *call, size_t i) { return scr_ffi_get_arg(call, i)->value.f64; }
bool scr_ffi_call_get_bool(const ScrFfiCall *call, size_t i) { return scr_ffi_get_arg(call, i)->value.u32 != 0; }
double scr_ffi_call_get_u8(const ScrFfiCall *call, size_t i) { return (double)scr_ffi_get_arg(call, i)->value.u32; }
double scr_ffi_call_get_u32(const ScrFfiCall *call, size_t i) { return (double)scr_ffi_get_arg(call, i)->value.u32; }
double scr_ffi_call_get_i32(const ScrFfiCall *call, size_t i) { return (double)scr_ffi_get_arg(call, i)->value.i32; }
const uint8_t *scr_ffi_call_get_data(const ScrFfiCall *call, size_t i) { return scr_ffi_get_arg(call, i)->value.span.data; }
size_t scr_ffi_call_get_len(const ScrFfiCall *call, size_t i) { return scr_ffi_get_arg(call, i)->value.span.len; }

static bool scr_ffi_pending(void) {
  bool pending;
  ScrFfiQueue *q = scr_ffi_queue();
  scr_ffi_lock_enter();
  pending = q->foreign_registrations > 0 || q->holds > 0 || q->head != NULL;
  scr_ffi_lock_leave();
  return pending;
}

static void scr_ffi_wake_drain(ScrFfiQueue *q) {
#if !defined(_WIN32) && !defined(__wasi__)
  if (q->wake_pipe[0] < 0) return;
  char buf[64];
  while (read(q->wake_pipe[0], buf, sizeof buf) > 0) {}
#else
  (void)q;
#endif
}

static bool scr_ffi_dispatch(void) {
  ScrFfiQueue *q = scr_ffi_queue();
  scr_ffi_lock_enter();
  ScrFfiCall *call = q->head;
  if (call != NULL) {
    q->head = call->next;
    if (q->head == NULL) q->tail = NULL;
  }
  scr_ffi_lock_leave();
  if (call == NULL) return false;

  if (call->table == NULL) {
    /* A C task: run it, then the same empty-queue drain as a callback. */
    call->task(call->task_arg);
    scr_ffi_lock_enter();
    if (q->head == NULL) scr_ffi_wake_drain(q);
    scr_ffi_lock_leave();
    free(call);
    return true;
  }

  call->dispatch(call->callback, call);

  ScrFfiTable *table = call->table;
  scr_ffi_lock_enter();
  if (table->queued > 0) table->queued--;
  /* Keep the wake fd readable while queued calls remain. Drain only while
   * holding the same lock writers use, closing the post-vs-drain lost-wakeup
   * race for the transition to an empty queue. */
  bool more = q->head != NULL;
  if (!more) scr_ffi_wake_drain(q);
  scr_ffi_lock_leave();
  scr_ffi_call_free(call);
  scr_ffi_release_retired(table);
  return true;
}

static int scr_ffi_pollfd(void) { return scr_ffi_queue()->wake_pipe[0]; }

void scr_ffi_install(void) {
  ScrFfiQueue *q = scr_ffi_queue();
  if (q->installed) return;
  q->installed = true;
#if !defined(_WIN32) && !defined(__wasi__)
  int pipe_fds[2];
  if (pipe(pipe_fds) == 0) {
    for (int i = 0; i < 2; i++) {
      (void)fcntl(pipe_fds[i], F_SETFL, O_NONBLOCK);
      (void)fcntl(pipe_fds[i], F_SETFD, FD_CLOEXEC);
    }
    scr_ffi_lock_enter();
    q->wake_pipe[0] = pipe_fds[0];
    q->wake_pipe[1] = pipe_fds[1];
    scr_ffi_lock_leave();
  }
#endif
  scr_loop_set_ffi(&scr_ffi_pending, &scr_ffi_dispatch, &scr_ffi_pollfd,
                   &scr_ffi_stop);
}

void scr_ffi_stop(void) {
  ScrFfiQueue *q = scr_ffi_queue();
  scr_ffi_lock_enter();
  if (q->stopping) {
    scr_ffi_lock_leave();
    return;
  }
  q->stopping = true;
  ScrFfiCall *calls = q->head;
  q->head = q->tail = NULL;
  for (ScrFfiCall *call = calls; call != NULL; call = call->next) {
    if (call->table != NULL && call->table->queued > 0) call->table->queued--;
  }
  scr_ffi_wake_drain(q);
#if !defined(_WIN32) && !defined(__wasi__)
  if (q->wake_pipe[0] >= 0) close(q->wake_pipe[0]);
  if (q->wake_pipe[1] >= 0) close(q->wake_pipe[1]);
#endif
  q->wake_pipe[0] = q->wake_pipe[1] = -1;
  scr_ffi_lock_leave();
  while (calls != NULL) {
    ScrFfiCall *next = calls->next;
    ScrFfiTable *table = calls->table;
    scr_ffi_call_free(calls);
    if (table != NULL) scr_ffi_release_retired(table);
    calls = next;
  }
}

void scr_ffi_teardown_foreign(ScrFfiTable *table) {
  scr_ffi_stop();
  scr_ffi_lock_enter();
  ScrClosure **entries = table->entries;
  size_t len = table->len;
  ScrClosure **retired = table->retired;
  size_t retired_len = table->retired_len;
  ScrFfiQueue *owner = table->loop;
  if (owner != NULL && owner->foreign_registrations >= len) owner->foreign_registrations -= len;
  table->entries = NULL;
  table->len = 0;
  table->cap = 0;
  table->retired = NULL;
  table->retired_len = 0;
  table->retired_cap = 0;
  table->queued = 0;
  scr_ffi_lock_leave();
  for (size_t i = 0; i < len; i++) scr_closure_release(entries[i]);
  free(entries);
  for (size_t i = 0; i < retired_len; i++) scr_closure_release(retired[i]);
  free(retired);
}

/* ── the remote inbox (scr_runtime.h) ─────────────────────────────────
 * Another thread's way into this instance's loop: C tasks ride the same
 * per-instance queue, pipe and loop hook as foreign FFI callbacks. */
void *scr_instance_remote(void) {
  scr_ffi_install();
  return scr_ffi_queue();
}

void scr_remote_post(void *remote, void (*task)(void *), void *arg) {
  ScrFfiQueue *q = remote;
  ScrFfiCall *call = scr_ffi_foreign_alloc(sizeof *call);
  memset(call, 0, sizeof *call);
  call->task = task;
  call->task_arg = arg;
  call->loop = q;
  scr_ffi_lock_enter();
  if (q->stopping) {
    scr_ffi_lock_leave();
    free(call);
    return;
  }
  scr_ffi_enqueue_locked(q, call);
  void (*wake)(void *) = q->wake;
  void *wake_ctx = q->wake_ctx;
  scr_ffi_lock_leave();
  if (wake != NULL) wake(wake_ctx);
}

void scr_remote_hold(int delta) {
  ScrFfiQueue *q = scr_ffi_queue();
  scr_ffi_lock_enter();
  if (delta > 0) q->holds += (size_t)delta;
  else if ((size_t)-delta <= q->holds) q->holds -= (size_t)-delta;
  else q->holds = 0;
  scr_ffi_lock_leave();
}

void scr_remote_set_wake(void (*wake)(void *), void *ctx) {
  ScrFfiQueue *q = scr_ffi_queue();
  scr_ffi_lock_enter();
  q->wake = wake;
  q->wake_ctx = ctx;
  scr_ffi_lock_leave();
}
