/* The Android stack guard (packages/runtime/src/scr_stack_thread.h): on the thread a program's main runs on and on
 * another pthread, the guard lies inside the calling thread's own stack, scr_stack_guard_for's reserve above its low
 * end, and below the frame that asks. Built for aarch64-linux-android with the NDK and run under user-mode qemu by
 * tests/harness/host-island.test.ts. Prints one line per thread and exits 0, or names what failed. */
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>

#include "scr_stack_thread.h"

static int check(const char *who) {
  pthread_attr_t attr;
  void *low = NULL;
  size_t size = 0;
  if (pthread_getattr_np(pthread_self(), &attr) != 0 || pthread_attr_getstack(&attr, &low, &size) != 0) {
    printf("%s: no stack extent\n", who);
    return 1;
  }
  pthread_attr_destroy(&attr);
  uintptr_t guard = scr_stack_guard_of_thread();
  uintptr_t lo = (uintptr_t)low, hi = lo + size, here = (uintptr_t)__builtin_frame_address(0);
  int ok = guard > lo && guard < hi && guard < here && guard == scr_stack_guard_for(lo, size);
  printf("%s: %s\n", who, ok ? "guard inside the thread's stack" : "guard outside the thread's stack");
  return ok ? 0 : 1;
}

static void *thread(void *arg) {
  (void)arg;
  return (void *)(intptr_t)check("pthread");
}

int main(void) {
  int failed = check("main");
  pthread_t t;
  void *result = NULL;
  if (pthread_create(&t, NULL, thread, NULL) != 0 || pthread_join(t, &result) != 0) return 2;
  return failed || result != NULL;
}
