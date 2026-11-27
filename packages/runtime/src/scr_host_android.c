/* The host island's Android glue (the android-main output, libmain.so): two runtime-side answers a host needs on
 * Android, where the program's `main` is not the process's entry.
 *
 * - scr_host_android_is_main: whether the calling thread is the one the program's `main` runs on. The Activity glue
 *   in the host (libmatoya) starts `main` on a thread of its own, and a threaded host's render thread can enter the
 *   host before it, so the host cannot take "the first thread in" for main. The android-main link of a host-island
 *   program passes -Wl,--wrap=main, so the glue's call to `main` reaches __wrap_main here, which records the thread
 *   and runs the program's own main (__real_main).
 * - scr_host_install_uncaught_hook: installs the host's report of an uncaught throw or unhandled rejection into the
 *   runtime's hook (scr_exception.c), unless one is installed already. The hook is thread-local in a threaded
 *   runtime, and an ELF link refuses a plain extern of a TLS symbol from the host's archive, so the host sets it
 *   through this function.
 *
 * - scr_host_android_before_main: a hook __wrap_main calls first, before the program's main and before the thread is
 *   recorded, for an embedder to prepare the process (its environment, read by C code at the top of main). The
 *   runtime's own does nothing.
 *
 * Every definition here is weak, so an embedder's own copies (its entry glue, its uncaught hook) take their place
 * without a duplicate-symbol error.
 *
 * Elsewhere the unit is empty: other hosts find main their own way and write the hook directly. */
#ifdef __ANDROID__
#include <pthread.h>
#include <stdbool.h>

#include "scr_exception.h"

static pthread_t scr_android_main_thread;
static bool scr_android_main_known;

int __real_main(int argc, char **argv);
int __wrap_main(int argc, char **argv);
bool scr_host_android_is_main(void);
void scr_host_install_uncaught_hook(int (*hook)(bool from_promise));
void scr_host_android_before_main(void);

__attribute__((weak)) void scr_host_android_before_main(void) {}

__attribute__((weak)) int __wrap_main(int argc, char **argv) {
  scr_host_android_before_main();
  scr_android_main_thread = pthread_self();
  __atomic_store_n(&scr_android_main_known, true, __ATOMIC_RELEASE);
  return __real_main(argc, argv);
}

__attribute__((weak)) bool scr_host_android_is_main(void) {
  return __atomic_load_n(&scr_android_main_known, __ATOMIC_ACQUIRE) &&
         pthread_equal(pthread_self(), scr_android_main_thread);
}

__attribute__((weak)) void scr_host_install_uncaught_hook(int (*hook)(bool from_promise)) {
  if (scr_uncaught_exception_hook == NULL) scr_uncaught_exception_hook = hook;
}
#else
/* ISO C requires a translation unit to declare something. */
typedef int scr_host_android_unused;
#endif
