/* The native threads lane: shared.ts built as a thread-instanced library
 * (native-shared.json, abi.instance_per_thread), and N embedder threads,
 * each with its own runtime instance, blurring one image in this host's
 * memory (mutable-bytes spans). The main thread's instance fills the image,
 * resets the counter and checksums; a round releases every worker through a
 * barrier and waits for all of them, as the other hosts do. One untimed
 * round, then 8 timed ones.   ./native-host <workers>
 * Original code, Apache-2.0. */
#define _POSIX_C_SOURCE 200809L
#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <time.h>

extern void blur_init(void);
extern void blur_set_panic_sink(void (*fn)(void *, const uint8_t *, size_t, uint64_t), void *ctx);
extern void blur_fill(uint8_t *src, size_t len);
extern void blur_reset(uint8_t *cells, size_t len);
extern double blur_work(uint8_t *src, size_t a, uint8_t *dst, size_t b, uint8_t *tmp, size_t c, uint8_t *cells, size_t d);
extern double blur_checksum(uint8_t *dst, size_t len);

#define W 1024
#define H 768
#define ROUNDS 8
#define MAXW 64

static uint8_t src[W * H], dst[W * H];
static _Alignas(16) uint8_t tmp[W * H * 2];
static _Alignas(16) uint8_t cells[16];
static pthread_barrier_t go, done;
static int stop;
static double jobs[MAXW];

static void sink(void *ctx, const uint8_t *msg, size_t len, uint64_t addr) {
  (void)ctx; (void)addr;
  fprintf(stderr, "trap: %.*s\n", (int)len, (const char *)msg);
  exit(1);
}

static void *worker(void *arg) {
  int id = (int)(intptr_t)arg;
  blur_set_panic_sink(sink, NULL);
  blur_init();
  for (;;) {
    pthread_barrier_wait(&go);
    if (stop) return NULL;
    jobs[id] += blur_work(src, sizeof src, dst, sizeof dst, tmp, sizeof tmp, cells, 4);
    pthread_barrier_wait(&done);
  }
}

static double now_ms(void) {
  struct timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return t.tv_sec * 1e3 + t.tv_nsec / 1e6;
}

int main(int argc, char **argv) {
  int n = argc > 1 ? atoi(argv[1]) : 4;
  if (n < 1 || n > MAXW) return 2;
  blur_set_panic_sink(sink, NULL);
  blur_init();
  blur_fill(src, sizeof src);
  pthread_barrier_init(&go, NULL, n + 1);
  pthread_barrier_init(&done, NULL, n + 1);
  pthread_t t[MAXW];
  for (int i = 0; i < n; i++) pthread_create(&t[i], NULL, worker, (void *)(intptr_t)i);
  double t0 = 0;
  for (int r = 0; r <= ROUNDS; r++) {
    if (r == 1) {
      for (int i = 0; i < n; i++) jobs[i] = 0;
      t0 = now_ms();
    }
    blur_reset(cells, 4);
    pthread_barrier_wait(&go);
    pthread_barrier_wait(&done);
  }
  double ms = now_ms() - t0, total = 0;
  stop = 1;
  pthread_barrier_wait(&go);
  for (int i = 0; i < n; i++) { pthread_join(t[i], NULL); total += jobs[i]; }
  printf("bands 24 jobs %.0f blurred %.0f\n", total, blur_checksum(dst, sizeof dst));
  printf("time %.1f\n", ms);
  return 0;
}
