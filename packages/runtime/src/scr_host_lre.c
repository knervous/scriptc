/* libregexp's host hooks for a host-island link (scr_host_island.h). A dynamic-flavor link leaves these to the engine
 * archive (scr_regex.c's SCR_DYNAMIC half calls scr_island_lre_opaque, and quickjs.c defines the lre_* hooks with its
 * JSContext as the opaque); the host island links no engine, so this unit gives them the static flavor's meaning: no
 * opaque, no stack guard, no timeout, the C allocator. Linked only with scr_host_island.c, never beside the engine
 * island, which defines the same symbols. */
#include <stdbool.h>
#include <stddef.h>
#include <stdlib.h>

void *scr_island_lre_opaque(void);
bool lre_check_stack_overflow(void *opaque, size_t alloca_size);
int lre_check_timeout(void *opaque);
void *lre_realloc(void *opaque, void *ptr, size_t size);

void *scr_island_lre_opaque(void) { return NULL; }

bool lre_check_stack_overflow(void *opaque, size_t alloca_size) {
  (void)opaque;
  (void)alloca_size;
  return false;
}

int lre_check_timeout(void *opaque) {
  (void)opaque;
  return 0;
}

void *lre_realloc(void *opaque, void *ptr, size_t size) {
  (void)opaque;
  if (size == 0) {
    free(ptr);
    return NULL;
  }
  return realloc(ptr, size);
}
