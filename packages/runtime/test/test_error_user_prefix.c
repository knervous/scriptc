/* The error view of a user Error subclass must read only the layout prefix the subclass embeds (rc through stack):
 * the fields past it (system_errno through errno_undefined) exist only on errors the runtime allocates. The fixture
 * copies a runtime error's prefix into an allocation of exactly the prefix's size, as the compiler lays out a user
 * subclass with no own fields, gives it a non-builtin vtable, and builds its view; under AddressSanitizer any read
 * past the prefix is a heap-buffer-overflow. */
#include "../src/scr_runtime.h"
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void) {
  ScrError *builtin = scr_error_new(SCR_ERR_ERROR, scr_str_new("boom", 4));
  static ScrVt user_vt;
  memcpy(&user_vt, builtin->vt, sizeof user_vt);
  size_t prefix = offsetof(ScrError, system_errno);
  ScrError *user = malloc(prefix);
  if (user == NULL) return 1;
  memcpy(user, builtin, prefix);
  user->vt = &user_vt;
  ScrDyn *view = scr_error_dyn_fields(user);
  bool has_errno = scr_dyn_obj_get(view, "errno", 5) != NULL;
  bool has_message = scr_dyn_obj_get(view, "message", 7) != NULL;
  printf("errno %s, message %s\n", has_errno ? "present" : "absent", has_message ? "present" : "absent");
  return has_errno || !has_message ? 1 : 0;
}
