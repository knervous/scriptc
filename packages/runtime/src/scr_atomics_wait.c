/* Atomics.wait, Atomics.notify and Atomics.waitAsync (with their untyped-argument forms), a runtime unit of its own
 * that the atomicsWait feature links: waitAsync settles its promise through the remote queue on a timer thread,
 * and a library archive links neither, so the operations every Atomics program uses stay in scr_lib.c. */
#include "scr_runtime.h"
#include "scr_atomics_private.h"

#include <errno.h>
#include <math.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#ifdef _WIN32
#include <windows.h>
#else
#include <pthread.h>
#endif

static SCR_TL bool scr_atomics_no_block;
void scr_atomics_set_may_block(bool may_block) { scr_atomics_no_block = !may_block; }

#if defined(__wasi__)
/* No threads: nothing can notify, so a wait compares, then sleeps out its
 * timeout (an infinite one is a certain deadlock and ends at once). */
ScrStr *scr_atomics_wait(ScrBytes *arr, double idx, double expected, double timeout_ms) {
  uint8_t *p = scr_atomics_addr(arr, idx);
  if (p == NULL) return NULL;
  if (__atomic_load_n((int32_t *)p, __ATOMIC_SEQ_CST) != (int32_t)scr_atomics_u32(expected)) return scr_str_new("not-equal", 9);
  double ms = timeout_ms;
  if (ms != ms || ms < 0 || isinf(ms)) ms = 0;
  if (ms > 0) {
    struct timespec left = {(time_t)(ms / 1000.0), (long)((ms - (double)(time_t)(ms / 1000.0) * 1000.0) * 1e6)};
    struct timespec rem;
    while (nanosleep(&left, &rem) != 0 && errno == EINTR) left = rem;
  }
  return scr_str_new("timed-out", 9);
}
double scr_atomics_notify(ScrBytes *arr, double idx, double count) {
  (void)count;
  return scr_atomics_addr(arr, idx) == NULL ? 0 : 0;
}
/* No threads: a wait that would park can only time out, and nothing could
 * wake the loop for it; answer synchronously. */
static int scr_at_async_last_wasi;
double scr_atomics_wait_async_start(ScrBytes *arr, double idx, double expected, double timeout_ms) {
  (void)timeout_ms;
  uint8_t *p = scr_atomics_addr(arr, idx);
  if (p == NULL) return 0;
  scr_at_async_last_wasi = __atomic_load_n((int32_t *)p, __ATOMIC_SEQ_CST) != (int32_t)scr_atomics_u32(expected) ? 0 : 1;
  return scr_at_async_last_wasi;
}
ScrPromise *scr_atomics_wait_async_promise(void) { return scr_promise_new(); }
ScrStr *scr_atomics_wait_async_result(void) {
  return scr_at_async_last_wasi == 0 ? scr_str_new("not-equal", 9) : scr_str_new("timed-out", 9);
}
#else
/* The waiter table: a waiter parks on its own condition variable under its
 * address's stripe lock; notify unlinks up to `count` waiters on that
 * address, oldest first, marks them and signals each. A waiter whose
 * deadline passes unlinks itself (when no notify already did). */
struct ScrAtAsync;
typedef struct ScrAtWaiter {
  const void *addr;
  bool notified;
  bool linked;
  struct ScrAtAsync *async; /* NULL: a blocking wait parked on cond */
#ifdef _WIN32
  CONDITION_VARIABLE cond;
#else
  pthread_cond_t cond;
#endif
  struct ScrAtWaiter *prev, *next;
} ScrAtWaiter;

#define SCR_AT_STRIPES 64
typedef struct {
#ifdef _WIN32
  SRWLOCK lock;
#else
  pthread_mutex_t lock;
#endif
  ScrAtWaiter *head, *tail;
} ScrAtStripe;

#ifdef _WIN32
static ScrAtStripe scr_at_stripes[SCR_AT_STRIPES]; /* SRWLOCK_INIT is all zero */
#define SCR_AT_LOCK(s) AcquireSRWLockExclusive(&(s)->lock)
#define SCR_AT_UNLOCK(s) ReleaseSRWLockExclusive(&(s)->lock)
#else
#define SCR_AT_STRIPE_INIT {PTHREAD_MUTEX_INITIALIZER, NULL, NULL}
#define SCR_AT_STRIPE_INIT8 SCR_AT_STRIPE_INIT, SCR_AT_STRIPE_INIT, SCR_AT_STRIPE_INIT, SCR_AT_STRIPE_INIT, \
  SCR_AT_STRIPE_INIT, SCR_AT_STRIPE_INIT, SCR_AT_STRIPE_INIT, SCR_AT_STRIPE_INIT
static ScrAtStripe scr_at_stripes[SCR_AT_STRIPES] = {SCR_AT_STRIPE_INIT8, SCR_AT_STRIPE_INIT8, SCR_AT_STRIPE_INIT8,
  SCR_AT_STRIPE_INIT8, SCR_AT_STRIPE_INIT8, SCR_AT_STRIPE_INIT8, SCR_AT_STRIPE_INIT8, SCR_AT_STRIPE_INIT8};
#define SCR_AT_LOCK(s) (void)pthread_mutex_lock(&(s)->lock)
#define SCR_AT_UNLOCK(s) (void)pthread_mutex_unlock(&(s)->lock)
#endif

static ScrAtStripe *scr_at_stripe(const void *addr) {
  uintptr_t a = (uintptr_t)addr >> 2;
  return &scr_at_stripes[(a ^ (a >> 6) ^ (a >> 12)) % SCR_AT_STRIPES];
}

static void scr_at_unlink(ScrAtStripe *s, ScrAtWaiter *w) {
  if (w->prev) w->prev->next = w->next; else s->head = w->next;
  if (w->next) w->next->prev = w->prev; else s->tail = w->prev;
  w->prev = w->next = NULL;
  w->linked = false;
}

static void scr_at_link(ScrAtStripe *s, ScrAtWaiter *w) {
  w->prev = s->tail;
  w->next = NULL;
  if (s->tail) s->tail->next = w; else s->head = w;
  s->tail = w;
  w->linked = true;
}

static void scr_at_async_unlinked(struct ScrAtAsync *a, int result);

ScrStr *scr_atomics_wait(ScrBytes *arr, double idx, double expected, double timeout_ms) {
  uint8_t *p = scr_atomics_addr(arr, idx);
  if (p == NULL) return NULL;
  if (scr_atomics_no_block) {
    scr_throw_error_msg(SCR_ERR_TYPE, "Atomics.wait cannot be called in this context", 45);
    return NULL;
  }
  int32_t want = (int32_t)scr_atomics_u32(expected);
  double ms = timeout_ms != timeout_ms ? INFINITY : timeout_ms < 0 ? 0 : timeout_ms;
  ScrAtStripe *s = scr_at_stripe(p);
  SCR_AT_LOCK(s);
  /* Under the stripe lock: a notify after this read cannot be missed (the
   * notifier takes the same lock to find us). */
  if (__atomic_load_n((int32_t *)p, __ATOMIC_SEQ_CST) != want) {
    SCR_AT_UNLOCK(s);
    return scr_str_new("not-equal", 9);
  }
  ScrAtWaiter w = {.addr = p};
  scr_at_link(s, &w);
#ifdef _WIN32
  InitializeConditionVariable(&w.cond);
  ULONGLONG deadline = isinf(ms) ? 0 : GetTickCount64() + (ULONGLONG)ceil(ms);
  while (!w.notified) {
    DWORD wait = INFINITE;
    if (!isinf(ms)) {
      ULONGLONG now = GetTickCount64();
      if (now >= deadline) break;
      wait = (DWORD)(deadline - now);
    }
    (void)SleepConditionVariableSRW(&w.cond, &s->lock, wait, 0);
  }
#else
  (void)pthread_cond_init(&w.cond, NULL);
  struct timespec deadline = {0, 0};
  if (!isinf(ms)) {
    clock_gettime(CLOCK_REALTIME, &deadline);
    double ns = (double)deadline.tv_nsec + ms * 1e6;
    deadline.tv_sec += (time_t)(ns / 1e9);
    deadline.tv_nsec = (long)fmod(ns, 1e9);
  }
  while (!w.notified) {
    if (isinf(ms)) (void)pthread_cond_wait(&w.cond, &s->lock);
    else if (pthread_cond_timedwait(&w.cond, &s->lock, &deadline) == ETIMEDOUT) break;
  }
#endif
  bool ok = w.notified;
  if (!ok) scr_at_unlink(s, &w);
  SCR_AT_UNLOCK(s);
#ifndef _WIN32
  (void)pthread_cond_destroy(&w.cond);
#endif
  return ok ? scr_str_new("ok", 2) : scr_str_new("timed-out", 9);
}

double scr_atomics_notify(ScrBytes *arr, double idx, double count) {
  uint8_t *p = scr_atomics_addr(arr, idx);
  if (p == NULL) return 0;
  double c = count != count ? 0 : count < 0 ? 0 : isinf(count) ? INFINITY : trunc(count);
  double woken = 0;
  ScrAtStripe *s = scr_at_stripe(p);
  SCR_AT_LOCK(s);
  for (ScrAtWaiter *w = s->head; w != NULL && woken < c;) {
    ScrAtWaiter *next = w->next;
    if (w->addr == p) {
      scr_at_unlink(s, w);
      w->notified = true;
      if (w->async != NULL) scr_at_async_unlinked(w->async, 1);
#ifdef _WIN32
      else WakeConditionVariable(&w->cond);
#else
      else (void)pthread_cond_signal(&w->cond);
#endif
      woken++;
    }
    w = next;
  }
  SCR_AT_UNLOCK(s);
  return woken;
}

/* ── Atomics.waitAsync ───────────────────────────────────────────────────
 * An async waiter sits in the waiter table like a blocking one. Whoever
 * unlinks it (a notify on any thread, or the timer thread at its deadline)
 * records the result and posts the settle to the starting instance's remote
 * inbox; the settle fulfills the promise on that instance's thread. The
 * struct is freed when its references drop: the settle's, and the timer
 * list's while it is listed. */
typedef struct ScrAtAsync {
  ScrAtWaiter w;
  void *remote;
  ScrPromise *promise;   /* the owning thread's */
  int result;            /* 1 ok, 2 timed-out; set by the unlinker */
  int refs;              /* atomic */
  double deadline;       /* monotonic ms; +Infinity: none */
  bool in_timer;
  struct ScrAtAsync *tnext, *tprev;
} ScrAtAsync;

static void scr_at_async_unref(ScrAtAsync *a) {
  if (__atomic_sub_fetch(&a->refs, 1, __ATOMIC_ACQ_REL) == 0) free(a);
}

static double scr_at_now_ms(void) {
#ifdef _WIN32
  return (double)GetTickCount64();
#else
  struct timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return (double)t.tv_sec * 1000.0 + (double)t.tv_nsec / 1e6;
#endif
}

/* The timer list: one process thread sleeps until the earliest deadline. */
#ifdef _WIN32
static SRWLOCK scr_at_timer_lock = SRWLOCK_INIT;
static CONDITION_VARIABLE scr_at_timer_cond = CONDITION_VARIABLE_INIT;
static INIT_ONCE scr_at_timer_once = INIT_ONCE_STATIC_INIT;
#define SCR_AT_TLOCK() AcquireSRWLockExclusive(&scr_at_timer_lock)
#define SCR_AT_TUNLOCK() ReleaseSRWLockExclusive(&scr_at_timer_lock)
#else
static pthread_mutex_t scr_at_timer_lock = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t scr_at_timer_cond = PTHREAD_COND_INITIALIZER;
static pthread_once_t scr_at_timer_once = PTHREAD_ONCE_INIT;
#define SCR_AT_TLOCK() (void)pthread_mutex_lock(&scr_at_timer_lock)
#define SCR_AT_TUNLOCK() (void)pthread_mutex_unlock(&scr_at_timer_lock)
#endif
static ScrAtAsync *scr_at_timers; /* sorted by deadline */

static void scr_at_timer_remove_locked(ScrAtAsync *a) {
  if (a->tprev) a->tprev->tnext = a->tnext; else scr_at_timers = a->tnext;
  if (a->tnext) a->tnext->tprev = a->tprev;
  a->tnext = a->tprev = NULL;
  a->in_timer = false;
}

static void scr_at_async_settle(void *arg);

/* Unlinked from the waiter table (its stripe lock held): record, then post
 * the settle to the starting instance. */
static void scr_at_async_unlinked(ScrAtAsync *a, int result) {
  a->result = result;
  scr_remote_post(a->remote, scr_at_async_settle, a);
}

static void scr_at_timer_run(void) {
  SCR_AT_TLOCK();
  for (;;) {
    ScrAtAsync *due = NULL;
    double now = scr_at_now_ms();
    if (scr_at_timers != NULL && scr_at_timers->deadline <= now) {
      due = scr_at_timers;
      scr_at_timer_remove_locked(due);
    }
    if (due != NULL) {
      /* Lock order: the timer list, then a stripe, then the inbox. */
      ScrAtStripe *s = scr_at_stripe(due->w.addr);
      SCR_AT_LOCK(s);
      if (due->w.linked) {
        scr_at_unlink(s, &due->w);
        scr_at_async_unlinked(due, 2);
      }
      SCR_AT_UNLOCK(s);
      SCR_AT_TUNLOCK();
      scr_at_async_unref(due); /* the list's reference */
      SCR_AT_TLOCK();
      continue;
    }
#ifdef _WIN32
    DWORD wait = INFINITE;
    if (scr_at_timers != NULL) wait = (DWORD)ceil(scr_at_timers->deadline - now);
    (void)SleepConditionVariableSRW(&scr_at_timer_cond, &scr_at_timer_lock, wait, 0);
#else
    if (scr_at_timers == NULL) {
      (void)pthread_cond_wait(&scr_at_timer_cond, &scr_at_timer_lock);
    } else {
      struct timespec at;
      clock_gettime(CLOCK_REALTIME, &at);
      double ns = (double)at.tv_nsec + (scr_at_timers->deadline - now) * 1e6;
      at.tv_sec += (time_t)(ns / 1e9);
      at.tv_nsec = (long)fmod(ns, 1e9);
      (void)pthread_cond_timedwait(&scr_at_timer_cond, &scr_at_timer_lock, &at);
    }
#endif
  }
}

#ifdef _WIN32
static DWORD WINAPI scr_at_timer_main(LPVOID unused) { (void)unused; scr_at_timer_run(); return 0; }
static BOOL CALLBACK scr_at_timer_start(PINIT_ONCE once, PVOID param, PVOID *ctx) {
  (void)once; (void)param; (void)ctx;
  HANDLE t = CreateThread(NULL, 0, scr_at_timer_main, NULL, 0, NULL);
  if (t == NULL) scr_trap("scriptc: could not start the Atomics.waitAsync timer\n");
  CloseHandle(t);
  return TRUE;
}
#else
static void *scr_at_timer_main(void *unused) { (void)unused; scr_at_timer_run(); return NULL; }
static void scr_at_timer_start(void) {
  pthread_t t;
  if (pthread_create(&t, NULL, scr_at_timer_main, NULL) != 0) scr_trap("scriptc: could not start the Atomics.waitAsync timer\n");
  (void)pthread_detach(t);
}
#endif

static void scr_at_timer_add(ScrAtAsync *a) {
#ifdef _WIN32
  InitOnceExecuteOnce(&scr_at_timer_once, scr_at_timer_start, NULL, NULL);
#else
  (void)pthread_once(&scr_at_timer_once, scr_at_timer_start);
#endif
  SCR_AT_TLOCK();
  ScrAtAsync *prev = NULL, *at = scr_at_timers;
  while (at != NULL && at->deadline <= a->deadline) { prev = at; at = at->tnext; }
  a->tprev = prev;
  a->tnext = at;
  if (prev) prev->tnext = a; else scr_at_timers = a;
  if (at) at->tprev = a;
  a->in_timer = true;
#ifdef _WIN32
  WakeConditionVariable(&scr_at_timer_cond);
#else
  (void)pthread_cond_signal(&scr_at_timer_cond);
#endif
  SCR_AT_TUNLOCK();
}

/* On the starting thread (a remote-inbox task): settle the promise, take the
 * waiter off the timer list if it is still there, drop the loop hold. */
static void scr_at_async_settle(void *arg) {
  ScrAtAsync *a = arg;
  bool listed;
  SCR_AT_TLOCK();
  listed = a->in_timer;
  if (listed) scr_at_timer_remove_locked(a);
  SCR_AT_TUNLOCK();
  if (listed) scr_at_async_unref(a);
  ScrPromise *p = a->promise;
  a->promise = NULL;
  scr_promise_fulfill_str(p, a->result == 1 ? scr_str_new("ok", 2) : scr_str_new("timed-out", 9));
  scr_promise_release(p);
  scr_remote_hold(-1);
  scr_at_async_unref(a);
}

static SCR_TL ScrPromise *scr_at_async_stash;
static SCR_TL int scr_at_async_last; /* 0 not-equal, 1 timed-out */

double scr_atomics_wait_async_start(ScrBytes *arr, double idx, double expected, double timeout_ms) {
  uint8_t *p = scr_atomics_addr(arr, idx);
  if (p == NULL) return 0;
  int32_t want = (int32_t)scr_atomics_u32(expected);
  double ms = timeout_ms != timeout_ms ? INFINITY : timeout_ms < 0 ? 0 : timeout_ms;
  ScrAtStripe *s = scr_at_stripe(p);
  SCR_AT_LOCK(s);
  if (__atomic_load_n((int32_t *)p, __ATOMIC_SEQ_CST) != want) {
    SCR_AT_UNLOCK(s);
    scr_at_async_last = 0;
    return 0;
  }
  if (ms == 0) {
    SCR_AT_UNLOCK(s);
    scr_at_async_last = 1;
    return 1;
  }
  ScrAtAsync *a = calloc(1, sizeof *a);
  if (a == NULL) scr_trap("scriptc: out of memory\n");
  a->w.addr = p;
  a->w.async = a;
  a->remote = scr_instance_remote();
  a->promise = scr_promise_new();
  a->deadline = isinf(ms) ? INFINITY : scr_at_now_ms() + ms;
  a->refs = isinf(ms) ? 1 : 2;
  scr_at_link(s, &a->w);
  SCR_AT_UNLOCK(s);
  scr_remote_hold(1);
  if (!isinf(ms)) scr_at_timer_add(a);
  if (scr_at_async_stash != NULL) scr_promise_release(scr_at_async_stash);
  scr_at_async_stash = scr_promise_retain(a->promise);
  return 2;
}

ScrPromise *scr_atomics_wait_async_promise(void) {
  ScrPromise *p = scr_at_async_stash;
  scr_at_async_stash = NULL;
  return p;
}

ScrStr *scr_atomics_wait_async_result(void) {
  return scr_at_async_last == 0 ? scr_str_new("not-equal", 9) : scr_str_new("timed-out", 9);
}
#endif

ScrStr *scr_atomics_wait_dyn(const ScrDyn *array, double index, double expected, double timeout) {
  ScrBytes *bytes = scr_atomics_dyn_array(array, true);
  return bytes ? scr_atomics_wait(bytes, index, expected, timeout) : NULL;
}

double scr_atomics_notify_dyn(const ScrDyn *array, double index, double count) {
  ScrBytes *bytes = scr_atomics_dyn_array(array, true);
  return bytes ? scr_atomics_notify(bytes, index, count) : 0;
}
