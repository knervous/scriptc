/* The native stack guard of a thread whose stack the thread library knows (scr_context.c scr_stack_guard_init): a
 * worker thread, and on Android every thread the program runs on. Android starts the program's main on a thread of
 * the host's Activity glue (libmatoya), and a threaded host's render thread is another pthread, so no runtime thread
 * runs on the process's main stack, and the main stack's measurement (AT_EXECFN, RLIMIT_STACK) would put the guard
 * above them: every call would throw "Maximum call stack size exceeded".
 *
 * The guard sits scr_stack_guard_for's reserve above the stack's low end. Zero when the extent is unknown, which
 * leaves the generated entry checks inert. Kept to this header so its one caller and the Android probe
 * (tests/harness/host-island.test.ts) compile the same code. */
#ifndef SCR_STACK_THREAD_H
#define SCR_STACK_THREAD_H

#if defined(__linux__)
#include <pthread.h>
#include <stddef.h>
#include <stdint.h>

#include "scr_core.h"

static inline uintptr_t scr_stack_guard_of_thread(void) {
  pthread_attr_t attr;
  void *low = NULL;
  size_t size = 0;
  if (pthread_getattr_np(pthread_self(), &attr) != 0) return 0;
  uintptr_t guard = 0;
  if (pthread_attr_getstack(&attr, &low, &size) == 0 && low && size)
    guard = scr_stack_guard_for((uintptr_t)low, size);
  pthread_attr_destroy(&attr);
  return guard;
}
#endif

#endif
