/* mutable-bytes in a thread-instanced archive: FOUR embedder threads, each
 * with its own instance, view ONE host buffer in place. Each thread stamps
 * its id into its own slice and counts 100000 claims on one shared cell
 * through Atomics. Main prints after every join, so stdout is
 * deterministic: the cell holds every claim, each slice its stamp, and an
 * instance's sum() reads the other threads' writes. */
#define _POSIX_C_SOURCE 200809L
#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

extern void tv_init(void);
extern void tv_set_panic_sink(void (*fn)(void *, const uint8_t *, size_t, uint64_t), void *ctx);
extern double tv_count(uint8_t *cells, size_t len, double n);
extern void tv_stamp(uint8_t *out, size_t len, double v);
extern double tv_sum(uint8_t *all, size_t len);

#define NTHREADS 4
#define SLICE 1000
#define CLAIMS 100000

static _Alignas(8) uint8_t cells[8];
static uint8_t image[NTHREADS * SLICE];
static double counted[NTHREADS];
static pthread_barrier_t stamped;
static double sums[NTHREADS];

static void sink(void *ctx, const uint8_t *msg, size_t len, uint64_t addr) {
  (void)ctx; (void)addr;
  fprintf(stderr, "trap: %.*s\n", (int)len, (const char *)msg);
}

static void *worker(void *arg) {
  int id = (int)(intptr_t)arg;
  tv_set_panic_sink(sink, NULL);
  tv_init();
  tv_stamp(image + id * SLICE, SLICE, id + 1);
  counted[id] = tv_count(cells, sizeof cells, CLAIMS);
  pthread_barrier_wait(&stamped);
  sums[id] = tv_sum(image, sizeof image);
  return NULL;
}

int main(void) {
  pthread_t t[NTHREADS];
  pthread_barrier_init(&stamped, NULL, NTHREADS);
  for (int i = 0; i < NTHREADS; i++) pthread_create(&t[i], NULL, worker, (void *)(intptr_t)i);
  for (int i = 0; i < NTHREADS; i++) pthread_join(t[i], NULL);
  int32_t total;
  memcpy(&total, cells, sizeof total);
  double even = 0;
  for (int i = 0; i < NTHREADS; i++) even += counted[i];
  printf("claims %d even %.0f\n", total, even);
  for (int i = 0; i < NTHREADS; i++) printf("t%d: slice %d sum %.0f\n", i, image[i * SLICE + SLICE / 2], sums[i]);
  return 0;
}
