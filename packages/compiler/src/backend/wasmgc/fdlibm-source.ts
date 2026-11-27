/* The in-module math library's source: V8's fdlibm (src/base/ieee754.cc) in the typed subset fdlibm.ts translates.
 * Plain IEEE arithmetic, operation for operation as the C is written: the same bits on every host. (V8 built for
 * arm64 fuses the multiply-adds the C compiler finds; those builds differ from this in the last bit of some results.)
 * pow is the exception to fdlibm: V8 takes it from the platform's libm, so it is fdlibm's front end (special values,
 * logarithm) with a double-double exponential, which rounds correctly in all but about 2 results in 10000. */
export const FDLIBM_SOURCE = `
/* fdlibm, as V8 ships it (src/base/ieee754.cc), in the subset the compiler's math library translates (math-lib.ts).
 * Every value is f64 or i32 (annotated); an integer literal takes the other operand's type. The intrinsics are
 * hi/lo (the words of a double), mk/setHi/setLo, toI/toF (C casts), idiv/irem, ltu/geu (unsigned compares),
 * newF/newI (zeroed arrays), fabs/sqrt/floor/copysign. Results are bit-identical to V8's. */

const huge = 1.0e300;
const tiny = 1.0e-300;
const two24 = 16777216.0;
const twon24 = 5.9604644775390625e-08;
const two54 = 1.8014398509481984e+16;
const twom54 = 5.5511151231257827e-17;
const two53 = 9007199254740992.0;
const pio2_hi = 1.57079632679489655800e+00;
const pio2_lo = 6.12323399573676603587e-17;
const pio4_hi = 7.85398163397448278999e-01;
const ln2_hi = 6.93147180369123816490e-01;
const ln2_lo = 1.90821492927058770002e-10;
const ln2 = 6.93147180559945286227e-01;
const invln2 = 1.44269504088896338700e+00;
const Lg1 = 6.666666666666735130e-01;
const Lg2 = 3.999999999940941908e-01;
const Lg3 = 2.857142874366239149e-01;
const Lg4 = 2.222219843214978396e-01;
const Lg5 = 1.818357216161805012e-01;
const Lg6 = 1.531383769920937332e-01;
const Lg7 = 1.479819860511658591e-01;
const pS0 = 1.66666666666666657415e-01;
const pS1 = -3.25565818622400915405e-01;
const pS2 = 2.01212532134862925881e-01;
const pS3 = -4.00555345006794114027e-02;
const pS4 = 7.91534994289814532176e-04;
const pS5 = 3.47933107596021167570e-05;
const qS1 = -2.40339491173441421878e+00;
const qS2 = 2.02094576023350569471e+00;
const qS3 = -6.88283971605453293030e-01;
const qS4 = 7.70381505559019352791e-02;
const P1 = 1.66666666666666019037e-01;
const P2 = -2.77777777770155933842e-03;
const P3 = 6.61375632143793436117e-05;
const P4 = -1.65339022054652515390e-06;
const P5 = 4.13813679705723846039e-08;

const two_over_pi: i32[] = [
  0xA2F983, 0x6E4E44, 0x1529FC, 0x2757D1, 0xF534DD, 0xC0DB62, 0x95993C, 0x439041, 0xFE5163,
  0xABDEBB, 0xC561B7, 0x246E3A, 0x424DD2, 0xE00649, 0x2EEA09, 0xD1921C, 0xFE1DEB, 0x1CB129,
  0xA73EE8, 0x8235F5, 0x2EBB44, 0x84E99C, 0x7026B4, 0x5F7E41, 0x3991D6, 0x398353, 0x39F49C,
  0x845F8B, 0xBDF928, 0x3B1FF8, 0x97FFDE, 0x05980F, 0xEF2F11, 0x8B5A0A, 0x6D1F6D, 0x367ECF,
  0x27CB09, 0xB74F46, 0x3F669E, 0x5FEA2D, 0x7527BA, 0xC7EBE5, 0xF17B3D, 0x0739F7, 0x8A5292,
  0xEA6BFB, 0x5FB11F, 0x8D5D08, 0x560330, 0x46FC7B, 0x6BABF0, 0xCFBC20, 0x9AF436, 0x1DA9E3,
  0x91615E, 0xE61B08, 0x659985, 0x5F14A0, 0x68408D, 0xFFD880, 0x4D7327, 0x310606, 0x1556CA,
  0x73A8C9, 0x60E27B, 0xC08C6B,
];
const npio2_hw: i32[] = [
  0x3FF921FB, 0x400921FB, 0x4012D97C, 0x401921FB, 0x401F6A7A, 0x4022D97C, 0x4025FDBB, 0x402921FB, 0x402C463A,
  0x402F6A7A, 0x4031475C, 0x4032D97C, 0x40346B9C, 0x4035FDBB, 0x40378FDB, 0x403921FB, 0x403AB41B, 0x403C463A,
  0x403DD85A, 0x403F6A7A, 0x40407E4C, 0x4041475C, 0x4042106C, 0x4042D97C, 0x4043A28C, 0x40446B9C, 0x404534AC,
  0x4045FDBB, 0x4046C6CB, 0x40478FDB, 0x404858EB, 0x404921FB,
];
const PIo2: f64[] = [1.57079625129699707031e+00, 7.54978941586159635335e-08, 5.39030252995776476554e-15, 3.28200341580791294123e-22, 1.27065575308067607349e-29, 1.22933308981111328932e-36, 2.73370053816464559624e-44, 2.16741683877804819444e-51];
const atanhi: f64[] = [4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00];
const atanlo: f64[] = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const aT: f64[] = [3.33333333333329318027e-01, -1.99999999998764832476e-01, 1.42857142725034663711e-01, -1.11111104054623557880e-01, 9.09088713343650656196e-02, -7.69187620504482999495e-02, 6.66107313738753120669e-02, -5.83357013379057348645e-02, 4.97687799461593236017e-02, -3.65315727442169155270e-02, 1.62858201153657823623e-02];
const tanT: f64[] = [3.33333333333334091986e-01, 1.33333333333201242699e-01, 5.39682539762260521377e-02, 2.18694882948595424599e-02, 8.86323982359930005737e-03, 3.59207910759131235356e-03, 1.45620945432529025516e-03, 5.88041240820264096874e-04, 2.46463134818469906812e-04, 7.81794442939557092300e-05, 7.14072491382608190305e-05, -1.85586374855275456654e-05, 2.59073051863633712884e-05];
const bp: f64[] = [1.0, 1.5];
const dp_h: f64[] = [0.0, 5.84962487220764160156e-01];
const dp_l: f64[] = [0.0, 1.35003920212974897128e-08];

/* The reduction's two outputs. */
let red0: f64 = 0.0;
let red1: f64 = 0.0;

function scalbn(x: f64, n: i32): f64 {
  let hx: i32 = hi(x);
  let lx: i32 = lo(x);
  let k: i32 = (hx & 0x7ff00000) >> 20;
  if (k == 0) {
    if ((lx | (hx & 0x7fffffff)) == 0) return x;
    x = x * two54;
    hx = hi(x);
    k = ((hx & 0x7ff00000) >> 20) - 54;
    if (n < -50000) return tiny * x;
  }
  if (k == 0x7ff) return x + x;
  k = k + n;
  if (k > 0x7fe) return huge * copysign(huge, x);
  if (k > 0) return setHi(x, (hx & 0x800fffff) | (k << 20));
  if (k <= -54) {
    if (n > 50000) return huge * copysign(huge, x);
    return tiny * copysign(tiny, x);
  }
  k += 54;
  x = setHi(x, (hx & 0x800fffff) | (k << 20));
  return x * twom54;
}

function k_sin(x: f64, y: f64, iy: i32): f64 {
  const S1 = -1.66666666666666324348e-01;
  const S2 = 8.33333333332248946124e-03;
  const S3 = -1.98412698298579493134e-04;
  const S4 = 2.75573137070700676789e-06;
  const S5 = -2.50507602534068634195e-08;
  const S6 = 1.58969099521155010221e-10;
  let ix: i32 = hi(x) & 0x7fffffff;
  if (ix < 0x3e400000) {
    if (toI(x) == 0) return x;
  }
  let z: f64 = x * x;
  let v: f64 = z * x;
  let r: f64 = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  if (iy == 0) return x + v * (S1 + z * r);
  return x - ((z * (0.5 * y - v * r) - y) - v * S1);
}

function k_cos(x: f64, y: f64): f64 {
  const C1 = 4.16666666666666019037e-02;
  const C2 = -1.38888888888741095749e-03;
  const C3 = 2.48015872894767294178e-05;
  const C4 = -2.75573143513906633035e-07;
  const C5 = 2.08757232129817482790e-09;
  const C6 = -1.13596475577881948265e-11;
  let ix: i32 = hi(x) & 0x7fffffff;
  if (ix < 0x3e400000) {
    if (toI(x) == 0) return 1.0;
  }
  let z: f64 = x * x;
  let r: f64 = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  if (ix < 0x3FD33333) return 1.0 - (0.5 * z - (z * r - x * y));
  let qx: f64;
  if (ix > 0x3fe90000) {
    qx = 0.28125;
  } else {
    qx = mk(ix - 0x00200000, 0);
  }
  let hz: f64 = 0.5 * z - qx;
  let a: f64 = 1.0 - qx;
  return a - (hz - (z * r - x * y));
}

function k_tan(x: f64, y: f64, iy: i32): f64 {
  const pio4 = 7.85398163397448278999e-01;
  const pio4lo = 3.06161699786838301793e-17;
  let hx: i32 = hi(x);
  let ix: i32 = hx & 0x7fffffff;
  let z: f64;
  let r: f64;
  let v: f64;
  let w: f64;
  let s: f64;
  let a: f64;
  let t: f64;
  if (ix < 0x3e300000) {
    if (toI(x) == 0) {
      let low: i32 = lo(x);
      if (((ix | low) | (iy + 1)) == 0) {
        return 1.0 / fabs(x);
      } else {
        if (iy == 1) {
          return x;
        } else {
          w = x + y;
          z = setLo(w, 0);
          v = y - (z - x);
          a = -1.0 / w;
          t = setLo(a, 0);
          s = 1.0 + t * z;
          return t + a * (s + t * v);
        }
      }
    }
  }
  if (ix >= 0x3FE59428) {
    if (hx < 0) {
      x = -x;
      y = -y;
    }
    z = pio4 - x;
    w = pio4lo - y;
    x = z + w;
    y = 0.0;
  }
  z = x * x;
  w = z * z;
  r = tanT[1] + w * (tanT[3] + w * (tanT[5] + w * (tanT[7] + w * (tanT[9] + w * tanT[11]))));
  v = z * (tanT[2] + w * (tanT[4] + w * (tanT[6] + w * (tanT[8] + w * (tanT[10] + w * tanT[12])))));
  s = z * x;
  r = y + z * (s * (r + v) + y);
  r += tanT[0] * s;
  w = x + r;
  if (ix >= 0x3FE59428) {
    v = toF(iy);
    return toF(1 - ((hx >> 30) & 2)) * (v - 2.0 * (x - (w * w / (w + v) - r)));
  }
  if (iy == 1) return w;
  z = setLo(w, 0);
  v = r - (z - x);
  a = -1.0 / w;
  t = setLo(a, 0);
  s = 1.0 + t * z;
  return t + a * (s + t * v);
}

/* x[0..nx) holds the argument as 24-bit chunks; the reduced value lands in red0/red1 (precision 2). */
function kernel_rem_pio2(x: f64[], e0: i32, nx: i32): i32 {
  let f: f64[] = newF(20);
  let fq: f64[] = newF(20);
  let q: f64[] = newF(20);
  let iq: i32[] = newI(20);
  let jk: i32 = 4;
  let jp: i32 = 4;
  let jx: i32 = nx - 1;
  let jv: i32 = idiv(e0 - 3, 24);
  if (jv < 0) jv = 0;
  let q0: i32 = e0 - 24 * (jv + 1);
  let j: i32 = jv - jx;
  let m: i32 = jx + jk;
  let i: i32;
  let k: i32;
  let fw: f64;
  let z: f64;
  let n: i32;
  let ih: i32;
  let carry: i32;
  for (i = 0; i <= m; i++) {
    f[i] = j < 0 ? 0.0 : toF(two_over_pi[j]);
    j++;
  }
  for (i = 0; i <= jk; i++) {
    fw = 0.0;
    for (j = 0; j <= jx; j++) fw += x[j] * f[jx + i - j];
    q[i] = fw;
  }
  let jz: i32 = jk;
  while (true) {
    j = jz;
    z = q[jz];
    for (i = 0; j > 0; i++) {
      fw = toF(toI(twon24 * z));
      iq[i] = toI(z - two24 * fw);
      z = q[j - 1] + fw;
      j--;
    }
    z = scalbn(z, q0);
    z -= 8.0 * floor(z * 0.125);
    n = toI(z);
    z -= toF(n);
    ih = 0;
    if (q0 > 0) {
      i = iq[jz - 1] >> (24 - q0);
      n += i;
      iq[jz - 1] -= i << (24 - q0);
      ih = iq[jz - 1] >> (23 - q0);
    } else if (q0 == 0) {
      ih = iq[jz - 1] >> 23;
    } else if (z >= 0.5) {
      ih = 2;
    }
    if (ih > 0) {
      n += 1;
      carry = 0;
      for (i = 0; i < jz; i++) {
        j = iq[i];
        if (carry == 0) {
          if (j != 0) {
            carry = 1;
            iq[i] = 0x1000000 - j;
          }
        } else {
          iq[i] = 0xffffff - j;
        }
      }
      if (q0 > 0) {
        if (q0 == 1) iq[jz - 1] &= 0x7fffff;
        else if (q0 == 2) iq[jz - 1] &= 0x3fffff;
      }
      if (ih == 2) {
        z = 1.0 - z;
        if (carry != 0) z -= scalbn(1.0, q0);
      }
    }
    if (z == 0.0) {
      j = 0;
      for (i = jz - 1; i >= jk; i--) j |= iq[i];
      if (j == 0) {
        k = 1;
        while (jk >= k && iq[jk - k] == 0) k++;
        for (i = jz + 1; i <= jz + k; i++) {
          f[jx + i] = toF(two_over_pi[jv + i]);
          fw = 0.0;
          for (j = 0; j <= jx; j++) fw += x[j] * f[jx + i - j];
          q[i] = fw;
        }
        jz += k;
        continue;
      }
    }
    break;
  }
  if (z == 0.0) {
    jz -= 1;
    q0 -= 24;
    while (iq[jz] == 0) {
      jz--;
      q0 -= 24;
    }
  } else {
    z = scalbn(z, -q0);
    if (z >= two24) {
      fw = toF(toI(twon24 * z));
      iq[jz] = toI(z - two24 * fw);
      jz += 1;
      q0 += 24;
      iq[jz] = toI(fw);
    } else {
      iq[jz] = toI(z);
    }
  }
  fw = scalbn(1.0, q0);
  for (i = jz; i >= 0; i--) {
    q[i] = fw * toF(iq[i]);
    fw *= twon24;
  }
  for (i = jz; i >= 0; i--) {
    fw = 0.0;
    for (k = 0; k <= jp && k <= jz - i; k++) fw += PIo2[k] * q[i + k];
    fq[jz - i] = fw;
  }
  fw = 0.0;
  for (i = jz; i >= 0; i--) fw += fq[i];
  red0 = ih == 0 ? fw : -fw;
  fw = fq[0] - fw;
  for (i = 1; i <= jz; i++) fw += fq[i];
  red1 = ih == 0 ? fw : -fw;
  return n & 7;
}

function rem_pio2(x: f64): i32 {
  const invpio2 = 6.36619772367581382433e-01;
  const pio2_1 = 1.57079632673412561417e+00;
  const pio2_1t = 6.07710050650619224932e-11;
  const pio2_2 = 6.07710050630396597660e-11;
  const pio2_2t = 2.02226624879595063154e-21;
  const pio2_3 = 2.02226624871116645580e-21;
  const pio2_3t = 8.47842766036889956997e-32;
  let hx: i32 = hi(x);
  let ix: i32 = hx & 0x7fffffff;
  let z: f64;
  let w: f64;
  let t: f64;
  let r: f64;
  let fn: f64;
  let n: i32;
  let i: i32;
  let j: i32;
  if (ix <= 0x3fe921fb) {
    red0 = x;
    red1 = 0.0;
    return 0;
  }
  if (ix < 0x4002d97c) {
    if (hx > 0) {
      z = x - pio2_1;
      if (ix != 0x3ff921fb) {
        red0 = z - pio2_1t;
        red1 = (z - red0) - pio2_1t;
      } else {
        z -= pio2_2;
        red0 = z - pio2_2t;
        red1 = (z - red0) - pio2_2t;
      }
      return 1;
    } else {
      z = x + pio2_1;
      if (ix != 0x3ff921fb) {
        red0 = z + pio2_1t;
        red1 = (z - red0) + pio2_1t;
      } else {
        z += pio2_2;
        red0 = z + pio2_2t;
        red1 = (z - red0) + pio2_2t;
      }
      return -1;
    }
  }
  if (ix <= 0x413921fb) {
    t = fabs(x);
    n = toI(t * invpio2 + 0.5);
    fn = toF(n);
    r = t - fn * pio2_1;
    w = fn * pio2_1t;
    if (n < 32 && ix != npio2_hw[n - 1]) {
      red0 = r - w;
    } else {
      j = ix >> 20;
      red0 = r - w;
      i = j - ((hi(red0) >> 20) & 0x7ff);
      if (i > 16) {
        t = r;
        w = fn * pio2_2;
        r = t - w;
        w = fn * pio2_2t - ((t - r) - w);
        red0 = r - w;
        i = j - ((hi(red0) >> 20) & 0x7ff);
        if (i > 49) {
          t = r;
          w = fn * pio2_3;
          r = t - w;
          w = fn * pio2_3t - ((t - r) - w);
          red0 = r - w;
        }
      }
    }
    red1 = (r - red0) - w;
    if (hx < 0) {
      red0 = -red0;
      red1 = -red1;
      return -n;
    }
    return n;
  }
  if (ix >= 0x7ff00000) {
    red0 = x - x;
    red1 = red0;
    return 0;
  }
  let e0: i32 = (ix >> 20) - 1046;
  z = setHi(x, ix - (e0 << 20));
  let tx: f64[] = newF(3);
  for (i = 0; i < 2; i++) {
    tx[i] = toF(toI(z));
    z = (z - tx[i]) * two24;
  }
  tx[2] = z;
  let nx: i32 = 3;
  while (tx[nx - 1] == 0.0) nx--;
  n = kernel_rem_pio2(tx, e0, nx);
  if (hx < 0) {
    red0 = -red0;
    red1 = -red1;
    return -n;
  }
  return n;
}

function sin(x: f64): f64 {
  let ix: i32 = hi(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return k_sin(x, 0.0, 0);
  if (ix >= 0x7ff00000) return x - x;
  let n: i32 = rem_pio2(x);
  let a: f64 = red0;
  let b: f64 = red1;
  n = n & 3;
  if (n == 0) return k_sin(a, b, 1);
  if (n == 1) return k_cos(a, b);
  if (n == 2) return -k_sin(a, b, 1);
  return -k_cos(a, b);
}

function cos(x: f64): f64 {
  let ix: i32 = hi(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return k_cos(x, 0.0);
  if (ix >= 0x7ff00000) return x - x;
  let n: i32 = rem_pio2(x);
  let a: f64 = red0;
  let b: f64 = red1;
  n = n & 3;
  if (n == 0) return k_cos(a, b);
  if (n == 1) return -k_sin(a, b, 1);
  if (n == 2) return -k_cos(a, b);
  return k_sin(a, b, 1);
}

function tan(x: f64): f64 {
  let ix: i32 = hi(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return k_tan(x, 0.0, 1);
  if (ix >= 0x7ff00000) return x - x;
  let n: i32 = rem_pio2(x);
  let a: f64 = red0;
  let b: f64 = red1;
  return k_tan(a, b, 1 - ((n & 1) << 1));
}

function atan(x: f64): f64 {
  let hx: i32 = hi(x);
  let ix: i32 = hx & 0x7fffffff;
  let id: i32;
  if (ix >= 0x44100000) {
    if (ix > 0x7ff00000 || (ix == 0x7ff00000 && lo(x) != 0)) return x + x;
    if (hx > 0) return atanhi[3] + atanlo[3];
    return -atanhi[3] - atanlo[3];
  }
  if (ix < 0x3fdc0000) {
    if (ix < 0x3e400000) {
      if (huge + x > 1.0) return x;
    }
    id = -1;
  } else {
    x = fabs(x);
    if (ix < 0x3ff30000) {
      if (ix < 0x3fe60000) {
        id = 0;
        x = (2.0 * x - 1.0) / (2.0 + x);
      } else {
        id = 1;
        x = (x - 1.0) / (x + 1.0);
      }
    } else {
      if (ix < 0x40038000) {
        id = 2;
        x = (x - 1.5) / (1.0 + 1.5 * x);
      } else {
        id = 3;
        x = -1.0 / x;
      }
    }
  }
  let z: f64 = x * x;
  let w: f64 = z * z;
  let s1: f64 = z * (aT[0] + w * (aT[2] + w * (aT[4] + w * (aT[6] + w * (aT[8] + w * aT[10])))));
  let s2: f64 = w * (aT[1] + w * (aT[3] + w * (aT[5] + w * (aT[7] + w * aT[9]))));
  if (id < 0) return x - x * (s1 + s2);
  z = atanhi[id] - ((x * (s1 + s2) - atanlo[id]) - x);
  return hx < 0 ? -z : z;
}

function atan2(y: f64, x: f64): f64 {
  const pi_o_4 = 7.8539816339744827900e-01;
  const pi_o_2 = 1.5707963267948965580e+00;
  const pi = 3.1415926535897931160e+00;
  const pi_lo = 1.2246467991473531772e-16;
  let hx: i32 = hi(x);
  let lx: i32 = lo(x);
  let ix: i32 = hx & 0x7fffffff;
  let hy: i32 = hi(y);
  let ly: i32 = lo(y);
  let iy: i32 = hy & 0x7fffffff;
  let z: f64;
  let k: i32;
  let m: i32;
  if (ix > 0x7ff00000 || (ix == 0x7ff00000 && lx != 0) || iy > 0x7ff00000 || (iy == 0x7ff00000 && ly != 0)) return x + y;
  if (((hx - 0x3ff00000) | lx) == 0) return atan(y);
  m = ((hy >> 31) & 1) | ((hx >> 30) & 2);
  if ((iy | ly) == 0) {
    if (m == 0 || m == 1) return y;
    if (m == 2) return pi + tiny;
    return -pi - tiny;
  }
  if ((ix | lx) == 0) return hy < 0 ? -pi_o_2 - tiny : pi_o_2 + tiny;
  if (ix == 0x7ff00000) {
    if (iy == 0x7ff00000) {
      if (m == 0) return pi_o_4 + tiny;
      if (m == 1) return -pi_o_4 - tiny;
      if (m == 2) return 3.0 * pi_o_4 + tiny;
      return -3.0 * pi_o_4 - tiny;
    } else {
      if (m == 0) return 0.0;
      if (m == 1) return -0.0;
      if (m == 2) return pi + tiny;
      return -pi - tiny;
    }
  }
  if (iy == 0x7ff00000) return hy < 0 ? -pi_o_2 - tiny : pi_o_2 + tiny;
  k = (iy - ix) >> 20;
  if (k > 60) {
    z = pi_o_2 + 0.5 * pi_lo;
    m = m & 1;
  } else if (hx < 0 && k < -60) {
    z = 0.0;
  } else {
    z = atan(fabs(y / x));
  }
  if (m == 0) return z;
  if (m == 1) return -z;
  if (m == 2) return pi - (z - pi_lo);
  return (z - pi_lo) - pi;
}

function asin(x: f64): f64 {
  let hx: i32 = hi(x);
  let ix: i32 = hx & 0x7fffffff;
  let t: f64 = 0.0;
  let w: f64;
  let p: f64;
  let q: f64;
  let c: f64;
  let r: f64;
  let s: f64;
  if (ix >= 0x3ff00000) {
    if (((ix - 0x3ff00000) | lo(x)) == 0) return x * pio2_hi + x * pio2_lo;
    return (x - x) / (x - x);
  } else if (ix < 0x3fe00000) {
    if (ix < 0x3e400000) {
      if (huge + x > 1.0) return x;
    } else {
      t = x * x;
    }
    p = t * (pS0 + t * (pS1 + t * (pS2 + t * (pS3 + t * (pS4 + t * pS5)))));
    q = 1.0 + t * (qS1 + t * (qS2 + t * (qS3 + t * qS4)));
    w = p / q;
    return x + x * w;
  }
  w = 1.0 - fabs(x);
  t = w * 0.5;
  p = t * (pS0 + t * (pS1 + t * (pS2 + t * (pS3 + t * (pS4 + t * pS5)))));
  q = 1.0 + t * (qS1 + t * (qS2 + t * (qS3 + t * qS4)));
  s = sqrt(t);
  if (ix >= 0x3FEF3333) {
    w = p / q;
    t = pio2_hi - (2.0 * (s + s * w) - pio2_lo);
  } else {
    w = setLo(s, 0);
    c = (t - w * w) / (s + w);
    r = p / q;
    p = 2.0 * s * r - (pio2_lo - 2.0 * c);
    q = pio4_hi - 2.0 * w;
    t = pio4_hi - (p - q);
  }
  if (hx > 0) return t;
  return -t;
}

function acos(x: f64): f64 {
  const pi = 3.14159265358979311600e+00;
  let hx: i32 = hi(x);
  let ix: i32 = hx & 0x7fffffff;
  let z: f64;
  let p: f64;
  let q: f64;
  let r: f64;
  let w: f64;
  let s: f64;
  let c: f64;
  let df: f64;
  if (ix >= 0x3ff00000) {
    if (((ix - 0x3ff00000) | lo(x)) == 0) {
      if (hx > 0) return 0.0;
      return pi + 2.0 * pio2_lo;
    }
    return (x - x) / (x - x);
  }
  if (ix < 0x3fe00000) {
    if (ix <= 0x3c600000) return pio2_hi + pio2_lo;
    z = x * x;
    p = z * (pS0 + z * (pS1 + z * (pS2 + z * (pS3 + z * (pS4 + z * pS5)))));
    q = 1.0 + z * (qS1 + z * (qS2 + z * (qS3 + z * qS4)));
    r = p / q;
    return pio2_hi - (x - (pio2_lo - x * r));
  } else if (hx < 0) {
    z = (1.0 + x) * 0.5;
    p = z * (pS0 + z * (pS1 + z * (pS2 + z * (pS3 + z * (pS4 + z * pS5)))));
    q = 1.0 + z * (qS1 + z * (qS2 + z * (qS3 + z * qS4)));
    s = sqrt(z);
    r = p / q;
    w = r * s - pio2_lo;
    return pi - 2.0 * (s + w);
  } else {
    z = (1.0 - x) * 0.5;
    s = sqrt(z);
    df = setLo(s, 0);
    c = (z - df * df) / (s + df);
    p = z * (pS0 + z * (pS1 + z * (pS2 + z * (pS3 + z * (pS4 + z * pS5)))));
    q = 1.0 + z * (qS1 + z * (qS2 + z * (qS3 + z * qS4)));
    r = p / q;
    w = r * s + c;
    return 2.0 * (df + w);
  }
}

function exp(x: f64): f64 {
  const o_threshold = 7.09782712893383973096e+02;
  const u_threshold = -7.45133219101941108420e+02;
  const E = 2.718281828459045;
  const twom1000 = 9.33263618503218878990e-302;
  const two1023 = 8.988465674311579539e307;
  let hx: i32 = hi(x);
  let xsb: i32 = (hx >> 31) & 1;
  hx = hx & 0x7fffffff;
  let hiv: f64 = 0.0;
  let lov: f64 = 0.0;
  let k: i32 = 0;
  let t: f64;
  let c: f64;
  let y: f64;
  let twopk: f64;
  if (hx >= 0x40862E42) {
    if (hx >= 0x7ff00000) {
      if (((hx & 0xfffff) | lo(x)) != 0) return x + x;
      return xsb == 0 ? x : 0.0;
    }
    if (x > o_threshold) return huge * huge;
    if (x < u_threshold) return twom1000 * twom1000;
  }
  if (hx > 0x3fd62e42) {
    if (hx < 0x3FF0A2B2) {
      if (x == 1.0) return E;
      if (xsb == 0) {
        hiv = x - ln2_hi;
        lov = ln2_lo;
        k = 1;
      } else {
        hiv = x + ln2_hi;
        lov = -ln2_lo;
        k = -1;
      }
    } else {
      k = toI(invln2 * x + (xsb == 0 ? 0.5 : -0.5));
      t = toF(k);
      hiv = x - t * ln2_hi;
      lov = t * ln2_lo;
    }
    x = hiv - lov;
  } else if (hx < 0x3e300000) {
    if (huge + x > 1.0) return 1.0 + x;
  } else {
    k = 0;
  }
  t = x * x;
  if (k >= -1021) {
    twopk = mk(0x3ff00000 + (k << 20), 0);
  } else {
    twopk = mk(0x3ff00000 + ((k + 1000) << 20), 0);
  }
  c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  if (k == 0) return 1.0 - ((x * c) / (c - 2.0) - x);
  y = 1.0 - ((lov - (x * c) / (2.0 - c)) - hiv);
  if (k >= -1021) {
    if (k == 1024) return y * 2.0 * two1023;
    return y * twopk;
  }
  return y * twopk * twom1000;
}

function expm1(x: f64): f64 {
  const o_threshold = 7.09782712893383973096e+02;
  const Q1 = -3.33333333333331316428e-02;
  const Q2 = 1.58730158725481460165e-03;
  const Q3 = -7.93650757867487942473e-05;
  const Q4 = 4.00821782732936239552e-06;
  const Q5 = -2.01099218183624371326e-07;
  let hx: i32 = hi(x);
  let xsb: i32 = hx & 0x80000000;
  hx = hx & 0x7fffffff;
  let y: f64;
  let hiv: f64;
  let lov: f64;
  let c: f64 = 0.0;
  let t: f64;
  let e: f64;
  let hxs: f64;
  let hfx: f64;
  let r1: f64;
  let twopk: f64;
  let k: i32;
  if (hx >= 0x4043687A) {
    if (hx >= 0x40862E42) {
      if (hx >= 0x7ff00000) {
        if (((hx & 0xfffff) | lo(x)) != 0) return x + x;
        return xsb == 0 ? x : -1.0;
      }
      if (x > o_threshold) return huge * huge;
    }
    if (xsb != 0) {
      if (x + tiny < 0.0) return tiny - 1.0;
    }
  }
  if (hx > 0x3fd62e42) {
    if (hx < 0x3FF0A2B2) {
      if (xsb == 0) {
        hiv = x - ln2_hi;
        lov = ln2_lo;
        k = 1;
      } else {
        hiv = x + ln2_hi;
        lov = -ln2_lo;
        k = -1;
      }
    } else {
      k = toI(invln2 * x + (xsb == 0 ? 0.5 : -0.5));
      t = toF(k);
      hiv = x - t * ln2_hi;
      lov = t * ln2_lo;
    }
    x = hiv - lov;
    c = (hiv - x) - lov;
  } else if (hx < 0x3c900000) {
    t = huge + x;
    return x - (t - (huge + x));
  } else {
    k = 0;
  }
  hfx = 0.5 * x;
  hxs = x * hfx;
  r1 = 1.0 + hxs * (Q1 + hxs * (Q2 + hxs * (Q3 + hxs * (Q4 + hxs * Q5))));
  t = 3.0 - r1 * hfx;
  e = hxs * ((r1 - t) / (6.0 - x * t));
  if (k == 0) return x - (x * e - hxs);
  twopk = mk(0x3ff00000 + (k << 20), 0);
  e = x * (e - c) - c;
  e -= hxs;
  if (k == -1) return 0.5 * (x - e) - 0.5;
  if (k == 1) {
    if (x < -0.25) return -2.0 * (e - (x + 0.5));
    return 1.0 + 2.0 * (x - e);
  }
  if (k <= -2 || k > 56) {
    y = 1.0 - (e - x);
    if (k == 1024) y = y * 2.0 * 8.98846567431158e+307;
    else y = y * twopk;
    return y - 1.0;
  }
  t = 1.0;
  if (k < 20) {
    t = mk(0x3ff00000 - (0x200000 >> k), 0);
    y = t - (e - x);
    y = y * twopk;
  } else {
    t = mk((0x3ff - k) << 20, 0);
    y = x - (e + t);
    y += 1.0;
    y = y * twopk;
  }
  return y;
}

function log(x: f64): f64 {
  let hx: i32 = hi(x);
  let lx: i32 = lo(x);
  let k: i32 = 0;
  let hfsq: f64;
  let f: f64;
  let s: f64;
  let z: f64;
  let R: f64;
  let w: f64;
  let t1: f64;
  let t2: f64;
  let dk: f64;
  let i: i32;
  let j: i32;
  if (hx < 0x00100000) {
    if (((hx & 0x7fffffff) | lx) == 0) return -two54 / 0.0;
    if (hx < 0) return (x - x) / 0.0;
    k -= 54;
    x *= two54;
    hx = hi(x);
  }
  if (hx >= 0x7ff00000) return x + x;
  k += (hx >> 20) - 1023;
  hx &= 0x000fffff;
  i = (hx + 0x95f64) & 0x100000;
  x = setHi(x, hx | (i ^ 0x3ff00000));
  k += i >> 20;
  f = x - 1.0;
  if ((0x000fffff & (2 + hx)) < 3) {
    if (f == 0.0) {
      if (k == 0) return 0.0;
      dk = toF(k);
      return dk * ln2_hi + dk * ln2_lo;
    }
    R = f * f * (0.5 - 0.33333333333333333 * f);
    if (k == 0) return f - R;
    dk = toF(k);
    return dk * ln2_hi - ((R - dk * ln2_lo) - f);
  }
  s = f / (2.0 + f);
  dk = toF(k);
  z = s * s;
  i = hx - 0x6147a;
  w = z * z;
  j = 0x6b851 - hx;
  t1 = w * (Lg2 + w * (Lg4 + w * Lg6));
  t2 = z * (Lg1 + w * (Lg3 + w * (Lg5 + w * Lg7)));
  i |= j;
  R = t2 + t1;
  if (i > 0) {
    hfsq = 0.5 * f * f;
    if (k == 0) return f - (hfsq - s * (hfsq + R));
    return dk * ln2_hi - ((hfsq - (s * (hfsq + R) + dk * ln2_lo)) - f);
  }
  if (k == 0) return f - s * (f - R);
  return dk * ln2_hi - ((s * (f - R) - dk * ln2_lo) - f);
}

function log1p(x: f64): f64 {
  const Lp1 = 6.666666666666735130e-01;
  const Lp2 = 3.999999999940941908e-01;
  const Lp3 = 2.857142874366239149e-01;
  const Lp4 = 2.222219843214978396e-01;
  const Lp5 = 1.818357216161805012e-01;
  const Lp6 = 1.531383769920937332e-01;
  const Lp7 = 1.479819860511658591e-01;
  let hx: i32 = hi(x);
  let ax: i32 = hx & 0x7fffffff;
  let k: i32 = 1;
  let hu: i32 = 0;
  let hfsq: f64;
  let f: f64 = 0.0;
  let c: f64 = 0.0;
  let s: f64;
  let z: f64;
  let R: f64;
  let u: f64;
  let dk: f64;
  if (hx < 0x3FDA827A) {
    if (ax >= 0x3ff00000) {
      if (x == -1.0) return -two54 / 0.0;
      return (x - x) / (x - x);
    }
    if (ax < 0x3e200000) {
      if (two54 + x > 0.0 && ax < 0x3c900000) return x;
      return x - x * x * 0.5;
    }
    if (hx > 0 || hx <= (0xbfd2bec4 | 0)) {
      k = 0;
      f = x;
      hu = 1;
    }
  } else if (hx >= 0x7ff00000) {
    return x + x;
  }
  if (k != 0) {
    if (hx < 0x43400000) {
      u = 1.0 + x;
      hu = hi(u);
      k = (hu >> 20) - 1023;
      c = k > 0 ? 1.0 - (u - x) : x - (u - 1.0);
      c /= u;
    } else {
      u = x;
      hu = hi(u);
      k = (hu >> 20) - 1023;
      c = 0.0;
    }
    hu &= 0x000fffff;
    if (hu < 0x6a09e) {
      u = setHi(u, hu | 0x3ff00000);
    } else {
      k += 1;
      u = setHi(u, hu | 0x3fe00000);
      hu = (0x00100000 - hu) >> 2;
    }
    f = u - 1.0;
  }
  hfsq = 0.5 * f * f;
  dk = toF(k);
  if (hu == 0) {
    if (f == 0.0) {
      if (k == 0) return 0.0;
      c += dk * ln2_lo;
      return dk * ln2_hi + c;
    }
    R = hfsq * (1.0 - 0.66666666666666666 * f);
    if (k == 0) return f - R;
    return dk * ln2_hi - ((R - (dk * ln2_lo + c)) - f);
  }
  s = f / (2.0 + f);
  z = s * s;
  R = z * (Lp1 + z * (Lp2 + z * (Lp3 + z * (Lp4 + z * (Lp5 + z * (Lp6 + z * Lp7))))));
  if (k == 0) return f - (hfsq - s * (hfsq + R));
  return dk * ln2_hi - ((hfsq - (s * (hfsq + R) + (dk * ln2_lo + c))) - f);
}

function log2(x: f64): f64 {
  const ivln2hi = 1.44269504072144627571e+00;
  const ivln2lo = 1.67517131648865118353e-10;
  let hx: i32 = hi(x);
  let lx: i32 = lo(x);
  let k: i32 = 0;
  let i: i32;
  let f: f64;
  let hfsq: f64;
  let hif: f64;
  let lof: f64;
  let r: f64;
  let val_hi: f64;
  let val_lo: f64;
  let w: f64;
  let y: f64;
  let s: f64;
  let z: f64;
  let t1: f64;
  let t2: f64;
  if (hx < 0x00100000) {
    if (((hx & 0x7fffffff) | lx) == 0) return -two54 / 0.0;
    if (hx < 0) return (x - x) / 0.0;
    k -= 54;
    x *= two54;
    hx = hi(x);
  }
  if (hx >= 0x7ff00000) return x + x;
  if (hx == 0x3ff00000 && lx == 0) return 0.0;
  k += (hx >> 20) - 1023;
  hx &= 0x000fffff;
  i = (hx + 0x95f64) & 0x100000;
  x = setHi(x, hx | (i ^ 0x3ff00000));
  k += i >> 20;
  y = toF(k);
  f = x - 1.0;
  hfsq = 0.5 * f * f;
  s = f / (2.0 + f);
  z = s * s;
  w = z * z;
  t1 = w * (Lg2 + w * (Lg4 + w * Lg6));
  t2 = z * (Lg1 + w * (Lg3 + w * (Lg5 + w * Lg7)));
  r = s * (hfsq + (t2 + t1));
  hif = setLo(f - hfsq, 0);
  lof = (f - hif) - hfsq + r;
  val_hi = hif * ivln2hi;
  val_lo = (lof + hif) * ivln2lo + lof * ivln2hi;
  w = y + val_hi;
  val_lo += (y - w) + val_hi;
  val_hi = w;
  return val_lo + val_hi;
}

function log10(x: f64): f64 {
  const ivln10 = 4.34294481903251816668e-01;
  const log10_2hi = 3.01029995663611771306e-01;
  const log10_2lo = 3.69423907715893078616e-13;
  let hx: i32 = hi(x);
  let lx: i32 = lo(x);
  let k: i32 = 0;
  let i: i32;
  let y: f64;
  let z: f64;
  if (hx < 0x00100000) {
    if (((hx & 0x7fffffff) | lx) == 0) return -two54 / 0.0;
    if (hx < 0) return (x - x) / 0.0;
    k -= 54;
    x *= two54;
    hx = hi(x);
    lx = lo(x);
  }
  if (hx >= 0x7ff00000) return x + x;
  if (hx == 0x3ff00000 && lx == 0) return 0.0;
  k += (hx >> 20) - 1023;
  i = k >>> 31;
  hx = (hx & 0x000fffff) | ((0x3ff - i) << 20);
  y = toF(k + i);
  x = mk(hx, lx);
  z = y * log10_2lo + ivln10 * log(x);
  return z + y * log10_2hi;
}

function sinh(x: f64): f64 {
  const KSINH_OVERFLOW = 710.4758600739439;
  const TWO_M28 = 3.725290298461914e-9;
  const LOG_MAXD = 709.7822265625;
  const shuge = 1.0e307;
  let h: f64 = x < 0.0 ? -0.5 : 0.5;
  let ax: f64 = fabs(x);
  let t: f64;
  let w: f64;
  if (ax < 22.0) {
    if (ax < TWO_M28) return x;
    t = expm1(ax);
    if (ax < 1.0) return h * (2.0 * t - t * t / (t + 1.0));
    return h * (t + t / (t + 1.0));
  }
  if (ax < LOG_MAXD) return h * exp(ax);
  if (ax <= KSINH_OVERFLOW) {
    w = exp(0.5 * ax);
    t = h * w;
    return t * w;
  }
  return x * shuge;
}

function cosh(x: f64): f64 {
  const KCOSH_OVERFLOW = 710.4758600739439;
  let ix: i32 = hi(x) & 0x7fffffff;
  let t: f64;
  let w: f64;
  if (ix < 0x3fd62e43) {
    t = expm1(fabs(x));
    w = 1.0 + t;
    if (ix < 0x3c800000) return w;
    return 1.0 + (t * t) / (w + w);
  }
  if (ix < 0x40360000) {
    t = exp(fabs(x));
    return 0.5 * t + 0.5 / t;
  }
  if (ix < 0x40862e42) return 0.5 * exp(fabs(x));
  if (fabs(x) <= KCOSH_OVERFLOW) {
    w = exp(0.5 * fabs(x));
    t = 0.5 * w;
    return t * w;
  }
  if (ix >= 0x7ff00000) return x * x;
  return huge * huge;
}

function tanh(x: f64): f64 {
  let jx: i32 = hi(x);
  let ix: i32 = jx & 0x7fffffff;
  let t: f64;
  let z: f64;
  if (ix >= 0x7ff00000) {
    if (jx >= 0) return 1.0 / x + 1.0;
    return 1.0 / x - 1.0;
  }
  if (ix < 0x40360000) {
    if (ix < 0x3e300000) {
      if (huge + x > 1.0) return x;
    }
    if (ix >= 0x3ff00000) {
      t = expm1(2.0 * fabs(x));
      z = 1.0 - 2.0 / (t + 2.0);
    } else {
      t = expm1(-2.0 * fabs(x));
      z = -t / (t + 2.0);
    }
  } else {
    z = 1.0 - tiny;
  }
  return jx >= 0 ? z : -z;
}

function asinh(x: f64): f64 {
  let hx: i32 = hi(x);
  let ix: i32 = hx & 0x7fffffff;
  let t: f64;
  let w: f64;
  if (ix >= 0x7ff00000) return x + x;
  if (ix < 0x3e300000) {
    if (huge + x > 1.0) return x;
  }
  if (ix > 0x41b00000) {
    w = log(fabs(x)) + ln2;
  } else if (ix > 0x40000000) {
    t = fabs(x);
    w = log(2.0 * t + 1.0 / (sqrt(x * x + 1.0) + t));
  } else {
    t = x * x;
    w = log1p(fabs(x) + t / (1.0 + sqrt(1.0 + t)));
  }
  if (hx > 0) return w;
  return -w;
}

function acosh(x: f64): f64 {
  let hx: i32 = hi(x);
  let lx: i32 = lo(x);
  let t: f64;
  if (hx < 0x3ff00000) {
    return (x - x) / (x - x);
  } else if (hx >= 0x41b00000) {
    if (hx >= 0x7ff00000) return x + x;
    return log(x) + ln2;
  } else if (((hx - 0x3ff00000) | lx) == 0) {
    return 0.0;
  } else if (hx > 0x40000000) {
    t = x * x;
    return log(2.0 * x - 1.0 / (x + sqrt(t - 1.0)));
  } else {
    t = x - 1.0;
    return log1p(t + sqrt(2.0 * t + t * t));
  }
}

function atanh(x: f64): f64 {
  let hx: i32 = hi(x);
  let lx: i32 = lo(x);
  let ix: i32 = hx & 0x7fffffff;
  let t: f64;
  if ((ix | (lx != 0 ? 1 : 0)) > 0x3ff00000) return (x - x) / (x - x);
  if (ix == 0x3ff00000) return x / 0.0;
  if (ix < 0x3e300000 && huge + x > 0.0) return x;
  x = setHi(x, ix);
  if (ix < 0x3fe00000) {
    t = x + x;
    t = 0.5 * log1p(t + t * x / (1.0 - x));
  } else {
    t = 0.5 * log1p((x + x) / (1.0 - x));
  }
  if (hx >= 0) return t;
  return -t;
}

function cbrt(x: f64): f64 {
  const B1 = 715094163;
  const B2 = 696219795;
  const P0 = 1.87595182427177009643;
  const C1 = -1.88497979543377169875;
  const C2 = 1.621429720105354466140;
  const C3 = -0.758397934778766047437;
  const C4 = 0.145996192886612446982;
  let hx: i32 = hi(x);
  let low: i32 = lo(x);
  let sign: i32 = hx & 0x80000000;
  hx = hx ^ sign;
  let r: f64;
  let s: f64;
  let t: f64 = 0.0;
  let w: f64;
  let h: i32;
  let l: i32;
  if (hx >= 0x7ff00000) return x + x;
  if (hx < 0x00100000) {
    if ((hx | low) == 0) return x;
    t = mk(0x43500000, 0);
    t *= x;
    h = hi(t);
    t = mk(sign | (idiv(h & 0x7fffffff, 3) + B2), 0);
  } else {
    t = mk(sign | (idiv(hx, 3) + B1), 0);
  }
  r = (t * t) * (t / x);
  t = t * ((P0 + r * (C1 + r * C2)) + ((r * r) * r) * (C3 + r * C4));
  h = hi(t);
  l = lo(t);
  if (l < 0) h += 1;
  l = (l ^ 0x80000000) & 0xc0000000;
  t = mk(h, l);
  s = t * t;
  r = x / s;
  w = t + t;
  r = (r - t) / (w + r);
  t = t + t * r;
  return t;
}

/* exp(h + l) for |h| below 0.35 and l far smaller: 1 + expm1(h) carried in double-double through the h^2 and h^3 terms
 * (error near 2^-66 of the result), then one rounding. pow ends here, so its results are rounded correctly in all but a
 * few cases in a thousand, where V8 takes them from the platform's libm. */
function split_hi(a: f64): f64 {
  let c: f64 = 134217729.0 * a;
  return c - (c - a);
}

function exp_core(h: f64, l: f64): f64 {
  let hh: f64 = split_hi(h);
  let hl: f64 = h - hh;
  let ph: f64 = h * h;
  let pe: f64 = ((hh * hh - ph) + 2.0 * hh * hl) + hl * hl;
  let q: f64 = ph * h;
  let ph_h: f64 = split_hi(ph);
  let ph_l: f64 = ph - ph_h;
  let qe: f64 = ((ph_h * hh - q) + ph_h * hl + ph_l * hh) + ph_l * hl + pe * h;
  let c3: f64 = q / 6.0;
  let c3h: f64 = split_hi(c3);
  let p6: f64 = c3 * 6.0;
  let e6: f64 = (c3h * 6.0 - p6) + (c3 - c3h) * 6.0;
  let c3l: f64 = (((q - p6) - e6) + qe) / 6.0;
  let t2h: f64 = 0.5 * ph;
  let a1: f64 = h + t2h;
  let bb: f64 = a1 - h;
  let e1: f64 = (h - (a1 - bb)) + (t2h - bb);
  e1 += 0.5 * pe;
  let a2: f64 = a1 + c3;
  bb = a2 - a1;
  let e2: f64 = (a1 - (a2 - bb)) + (c3 - bb);
  let tail: f64 = ph * ph * (0.041666666666666664 + h * (0.008333333333333333 + h * (0.001388888888888889 + h * (0.0001984126984126984 + h * (2.48015873015873e-05 + h * (2.7557319223985893e-06 + h * (2.755731922398589e-07 + h * (2.505210838544172e-08 + h * (2.08767569878681e-09 + h * (1.6059043836821613e-10 + h * (1.1470745597729725e-11 + h * (7.647163731819816e-13 + h * (4.779477332387385e-14)))))))))))));
  let low: f64 = e1 + e2 + c3l + tail;
  let ehi: f64 = a2 + low;
  let elo: f64 = low - (ehi - a2);
  let sh: f64 = 1.0 + ehi;
  bb = sh - 1.0;
  let se: f64 = (1.0 - (sh - bb)) + (ehi - bb);
  return sh + (se + elo + l * sh);
}

function pow(x: f64, y: f64): f64 {
  const zero = 0.0;
  const one = 1.0;
  const two = 2.0;
  const L1 = 5.99999999999994648725e-01;
  const L2 = 4.28571428578550184252e-01;
  const L3 = 3.33333329818377432918e-01;
  const L4 = 2.72728123808534006489e-01;
  const L5 = 2.30660745775561754067e-01;
  const L6 = 2.06975017800338417784e-01;
  const lg2 = 6.93147180559945286227e-01;
  const lg2_h = 6.93147182464599609375e-01;
  const lg2_l = -1.90465429995776804525e-09;
  const ovt = 8.0085662595372944372e-17;
  const cp = 9.61796693925975554329e-01;
  const cp_h = 9.61796700954437255859e-01;
  const cp_l = -7.02846165095275826516e-09;
  const ivln2 = 1.44269504088896338700e+00;
  const ivln2_h = 1.44269502162933349609e+00;
  const ivln2_l = 1.92596299112661746887e-08;
  let hx: i32 = hi(x);
  let lx: i32 = lo(x);
  let hy: i32 = hi(y);
  let ly: i32 = lo(y);
  let ix: i32 = hx & 0x7fffffff;
  let iy: i32 = hy & 0x7fffffff;
  let z: f64;
  let ax: f64;
  let z_h: f64;
  let z_l: f64;
  let p_h: f64;
  let p_l: f64;
  let yh: f64;
  let t1: f64;
  let t2: f64;
  let r: f64;
  let s: f64;
  let t: f64;
  let u: f64;
  let v: f64;
  let w: f64;
  let i: i32;
  let j: i32;
  let k: i32;
  let n: i32;
  let yisint: i32 = 0;
  let ss: f64;
  let s2: f64;
  let s_h: f64;
  let s_l: f64;
  let t_h: f64;
  let t_l: f64;
  if ((iy | ly) == 0) return one;
  if (ix > 0x7ff00000 || (ix == 0x7ff00000 && lx != 0) || iy > 0x7ff00000 || (iy == 0x7ff00000 && ly != 0)) return x + y;
  if (hx < 0) {
    if (iy >= 0x43400000) {
      yisint = 2;
    } else if (iy >= 0x3ff00000) {
      k = (iy >> 20) - 0x3ff;
      if (k > 20) {
        j = ly >>> (52 - k);
        if ((j << (52 - k)) == ly) yisint = 2 - (j & 1);
      } else if (ly == 0) {
        j = iy >> (20 - k);
        if ((j << (20 - k)) == iy) yisint = 2 - (j & 1);
      }
    }
  }
  if (ly == 0) {
    if (iy == 0x7ff00000) {
      if (((ix - 0x3ff00000) | lx) == 0) return y - y;
      else if (ix >= 0x3ff00000) return hy >= 0 ? y : zero;
      else return hy < 0 ? -y : zero;
    }
    if (iy == 0x3ff00000) {
      if (hy < 0) return one / x;
      return x;
    }
    if (hy == 0x40000000) return x * x;
    if (hy == 0x3fe00000) {
      if (hx >= 0) return sqrt(x);
    }
  }
  ax = fabs(x);
  if (lx == 0) {
    if (ix == 0x7ff00000 || ix == 0 || ix == 0x3ff00000) {
      z = ax;
      if (hy < 0) z = one / z;
      if (hx < 0) {
        if (((ix - 0x3ff00000) | yisint) == 0) {
          z = (z - z) / (z - z);
        } else if (yisint == 1) {
          z = -z;
        }
      }
      return z;
    }
  }
  n = (hx >>> 31) - 1;
  if ((n | yisint) == 0) return (x - x) / (x - x);
  s = one;
  if ((n | (yisint - 1)) == 0) s = -one;
  if (iy > 0x41e00000) {
    if (iy > 0x43f00000) {
      if (ix <= 0x3fefffff) return hy < 0 ? huge * huge : tiny * tiny;
      if (ix >= 0x3ff00000) return hy > 0 ? huge * huge : tiny * tiny;
    }
    if (ix < 0x3fefffff) return hy < 0 ? s * huge * huge : s * tiny * tiny;
    if (ix > 0x3ff00000) return hy > 0 ? s * huge * huge : s * tiny * tiny;
    t = ax - one;
    w = (t * t) * (0.5 - t * (0.3333333333333333333333 - t * 0.25));
    u = ivln2_h * t;
    v = t * ivln2_l - w * ivln2;
    t1 = u + v;
    t1 = setLo(t1, 0);
    t2 = v - (t1 - u);
  } else {
    n = 0;
    if (ix < 0x00100000) {
      ax *= two53;
      n -= 53;
      ix = hi(ax);
    }
    n += (ix >> 20) - 0x3ff;
    j = ix & 0x000fffff;
    ix = j | 0x3ff00000;
    if (j <= 0x3988E) {
      k = 0;
    } else if (j < 0xBB67A) {
      k = 1;
    } else {
      k = 0;
      n += 1;
      ix -= 0x00100000;
    }
    ax = setHi(ax, ix);
    u = ax - bp[k];
    v = one / (ax + bp[k]);
    ss = u * v;
    s_h = setLo(ss, 0);
    t_h = mk(((ix >> 1) | 0x20000000) + 0x00080000 + (k << 18), 0);
    t_l = ax - (t_h - bp[k]);
    s_l = v * ((u - s_h * t_h) - s_h * t_l);
    s2 = ss * ss;
    r = s2 * s2 * (L1 + s2 * (L2 + s2 * (L3 + s2 * (L4 + s2 * (L5 + s2 * L6)))));
    r += s_l * (s_h + ss);
    s2 = s_h * s_h;
    t_h = 3.0 + s2 + r;
    t_h = setLo(t_h, 0);
    t_l = r - ((t_h - 3.0) - s2);
    u = s_h * t_h;
    v = s_l * t_h + t_l * ss;
    p_h = u + v;
    p_h = setLo(p_h, 0);
    p_l = v - (p_h - u);
    z_h = cp_h * p_h;
    z_l = cp_l * p_h + p_l * cp + dp_l[k];
    t = toF(n);
    t1 = ((z_h + z_l) + dp_h[k]) + t;
    t1 = setLo(t1, 0);
    t2 = z_l - (((t1 - t) - dp_h[k]) - z_h);
  }
  yh = setLo(y, 0);
  p_l = (y - yh) * t1 + y * t2;
  p_h = yh * t1;
  z = p_l + p_h;
  j = hi(z);
  i = lo(z);
  if (j >= 0x40900000) {
    if (((j - 0x40900000) | i) != 0) return s * huge * huge;
    if (p_l + ovt > z - p_h) return s * huge * huge;
  } else if ((j & 0x7fffffff) >= 0x4090cc00) {
    if (((j - (0xc090cc00 | 0)) | i) != 0) return s * tiny * tiny;
    if (p_l <= z - p_h) return s * tiny * tiny;
  }
  i = j & 0x7fffffff;
  k = (i >> 20) - 0x3ff;
  n = 0;
  if (i > 0x3fe00000) {
    n = j + (0x00100000 >> (k + 1));
    k = ((n & 0x7fffffff) >> 20) - 0x3ff;
    t = mk(n & ~(0x000fffff >> k), 0);
    n = ((n & 0x000fffff) | 0x00100000) >> (20 - k);
    if (j < 0) n = -n;
    p_h -= t;
  }
  t = p_l + p_h;
  t = setLo(t, 0);
  u = t * lg2_h;
  v = (p_l - (t - p_h)) * lg2 + t * lg2_l;
  z = u + v;
  w = v - (z - u);
  z = exp_core(z, w);
  j = hi(z);
  j += n << 20;
  if ((j >> 20) <= 0) z = scalbn(z, n);
  else z = setHi(z, hi(z) + (n << 20));
  return s * z;
}
`;
