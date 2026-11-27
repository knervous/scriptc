/* What LLVM calls on a MinGW target that Zig's MinGW libraries do not have, for the x86_64-pc-windows-gnullvm links of
 * the native host's dependencies and of a program linked with the host (zig-wrapper.rs adds it to a link through
 * ZIG_WRAPPER_LINK_EXTRA): LLVM folds a sin and a cos of one value into sincos, which mingw-w64's libmingwex provides
 * and Zig's does not; and truncl (below). Compiled with -fno-builtin, so these are not folded back into calls to
 * themselves: `zig cc -target x86_64-windows-gnu -O2 -fno-builtin -c zig-mingw-shims.c`. */
#include <math.h>

void sincos(double x, double *s, double *c) {
  *s = sin(x);
  *c = cos(x);
}

void sincosf(float x, float *s, float *c) {
  *s = sinf(x);
  *c = cosf(x);
}

/* truncl, which a dependency's SIMD float paths can name on this target and Zig's MinGW does not provide. Through a
 * 64-bit integer, which truncates toward zero; a value too large for one has no fraction (a long double's 64-bit
 * mantissa), and NaN passes through. */
long double truncl(long double x) {
  const long double big = 9223372036854775808.0L; /* 2^63 */
  if (x != x || x >= big || x <= -big) return x;
  long double r = (long double)(long long)x;
  return (r == 0.0L && x < 0.0L) ? -0.0L : r;
}
