/* The small-object allocator (scr_runtime.h, scr_cycle.c) without a sanitizer, where it is live: every class and its
 * boundaries, recycling, zeroing of recycled blocks, large and foreign blocks to the system, and thread instances
 * freeing each other's blocks. Build: clang -std=c11 -O1 -I src test/test_small_alloc.c src/scr_cycle.c
 * (-DSCR_THREAD_INSTANCES -pthread for the threaded part). */
#include "scr_runtime.h"
#include <assert.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

_Noreturn void scr_trap(const char *msg) { fputs(msg, stderr); abort(); }

static int in_reservation(void *p) { return (uintptr_t)p - scr_sa_base < scr_sa_span; }

static void classes(void) {
  for (size_t n = 1; n <= SCR_SA_MAX + 64; n++) {
    unsigned char *p = scr_mem_calloc(n);
    assert(p && ((uintptr_t)p & 15) == 0);
    for (size_t i = 0; i < n; i++) assert(p[i] == 0);
    memset(p, 0xAB, n);
    assert(n <= SCR_SA_MAX ? in_reservation(p) : !in_reservation(p));
    scr_mem_free(p);
    /* Same class again: the recycled block, cleared. */
    unsigned char *q = scr_mem_calloc(n);
    if (n <= SCR_SA_MAX) assert(q == p);
    for (size_t i = 0; i < n; i++) assert(q[i] == 0);
    scr_mem_free(q);
  }
  void *sys = malloc(48);
  scr_mem_free(sys); /* a system block goes back to the system */
  scr_mem_free(NULL);
}

static void churn(void) {
  enum { N = 200000 };
  static _Thread_local void *live[N];
  for (int round = 0; round < 3; round++) {
    for (int i = 0; i < N; i++) {
      live[i] = scr_mem_calloc((size_t)(i % 300) + 1);
      memset(live[i], i & 0xFF, (size_t)(i % 300) + 1);
    }
    for (int i = 0; i < N; i++) {
      unsigned char *b = live[i];
      for (int k = 0; k < (i % 300) + 1; k++) assert(b[k] == (unsigned char)(i & 0xFF));
      scr_mem_free(b);
    }
  }
}

#ifdef SCR_THREAD_INSTANCES
enum { BLOCKS = 100000 };
static void *handoff[2][BLOCKS];
static void *alloc_side(void *arg) {
  void **out = arg;
  for (int i = 0; i < BLOCKS; i++) out[i] = scr_mem_calloc((size_t)(i % 200) + 8);
  churn();
  return NULL;
}
static void *free_side(void *arg) {
  void **in = arg;
  for (int i = 0; i < BLOCKS; i++) scr_mem_free(in[i]); /* another instance's blocks */
  churn();
  return NULL;
}
#endif

int main(void) {
  classes();
  churn();
  assert(scr_sa_span != 0);
#ifdef SCR_THREAD_INSTANCES
  pthread_t a, b;
  pthread_create(&a, NULL, alloc_side, handoff[0]);
  pthread_join(a, NULL);
  pthread_create(&a, NULL, free_side, handoff[0]);
  pthread_create(&b, NULL, alloc_side, handoff[1]);
  pthread_join(a, NULL);
  pthread_join(b, NULL);
  for (int i = 0; i < BLOCKS; i++) scr_mem_free(handoff[1][i]);
  puts("small alloc: threads ok");
#endif
  puts("small alloc: ok");
  return 0;
}
