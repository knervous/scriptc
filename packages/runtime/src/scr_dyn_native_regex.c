/* scriptc runtime — `s.replace(re, fn)` / `s.replaceAll(re, fn)` with a function replacement on the native dyn lane
 * (the regex intrinsic's replaceFn / replaceAllFn; scr_dyn_native.c has the other native-dyn forms). Its own unit so
 * regex-free programs keep the regex unit out of their link.
 *
 * The callback (a callable dyn value) is called with this undefined and (match, ...captures, offset, string); its
 * result is ToString'd. Matches come from the regex unit's own drains (scr_regex_match_all_into under /g, the first
 * match otherwise), so a nonparticipating capture reaches the callback as "" where Node passes undefined (the
 * documented match-slice divergence, SEMANTICS.md). Named groups (Node's trailing groups argument) and sticky
 * regexes are refused loudly (SC2020) rather than answered wrongly. */
#include "scr_dyn_native.h"

#include <stdlib.h>
#include <string.h>

static bool scr_native_flag(const ScrRegex *re, char flag) {
  return re->flags && memchr(re->flags->data, flag, re->flags->len) != NULL;
}

/* A named capture group `(?<name>` (not a lookbehind `(?<=` / `(?<!`) outside a character class, skipping escapes. */
static bool scr_native_named_groups(const ScrStr *source) {
  bool in_class = false;
  for (size_t i = 0; i < source->len; i++) {
    char c = source->data[i];
    if (c == '\\') { i++; continue; }
    if (in_class) { if (c == ']') in_class = false; continue; }
    if (c == '[') { in_class = true; continue; }
    if (c == '(' && i + 3 < source->len && source->data[i + 1] == '?' && source->data[i + 2] == '<' &&
        source->data[i + 3] != '=' && source->data[i + 3] != '!')
      return true;
  }
  return false;
}

static ScrStr *scr_native_join(ScrStr *left /*moves*/, ScrStr *right /*moves*/) {
  ScrStr *out = scr_str_concat(left, right);
  scr_str_release(left);
  scr_str_release(right);
  return out;
}

/* The callback's string for one match (row: [whole, ...captures]) at UTF-16 offset `offset`; NULL when it threw. */
static ScrStr *scr_native_replacement(ScrDyn *fn, ScrArr *row, double offset, ScrStr *subject) {
  size_t count = (size_t)scr_arr_len(row);
  ScrDyn **args = malloc((count + 2) * sizeof *args);
  if (!args) scr_trap("scriptc: out of memory\n");
  for (size_t i = 0; i < count; i++) {
    ScrStr *part = scr_arr_get_ref(row, (double)i);
    args[i] = scr_dyn_new_str(part);
    scr_str_release(part);
  }
  args[count] = scr_dyn_new_num(offset);
  args[count + 1] = scr_dyn_new_str(subject);
  ScrDyn *result = scr_dyn_call(fn, args, count + 2, "replacer");
  for (size_t i = 0; i < count + 2; i++) scr_dyn_release(args[i]);
  free(args);
  if (!result) return NULL;
  ScrStr *text = scr_dyn_string_coerce_js(result);
  scr_dyn_release(result);
  return text;
}

/* +1, or NULL with the error pending. Borrows every operand. */
ScrStr *scr_dyn_native_regex_replace_fn(ScrStr *subject, ScrRegex *re, ScrDyn *fn, bool all) {
  bool global = scr_native_flag(re, 'g');
  if (all && !global) {
    static const char message[] = "String.prototype.replaceAll called with a non-global RegExp argument";
    scr_throw_error_msg(SCR_ERR_TYPE, message, sizeof message - 1);
    return NULL;
  }
  if (scr_native_flag(re, 'y') || scr_native_named_groups(re->source)) {
    static const char message[] = "a function replacement over a sticky regex or one with named groups has no LLVM lowering yet";
    scr_throw_error_msg_code(SCR_ERR_ERROR, message, sizeof message - 1, "SC2020");
    return NULL;
  }
  ScrArr *rows, *indices;
  if (global) {
    indices = scr_arr_new(SCR_ELEM_F64, 0);
    rows = scr_regex_match_all_into(subject, re, indices);
    if (!rows) { scr_arr_release(indices); return NULL; }
  } else {
    ScrArr *row = scr_regex_match(subject, re);
    if (!row) return scr_str_retain(subject);
    static ScrArrOps rows_ops = { scr_arr_retain_v, scr_arr_release_v, NULL };
    rows = scr_arr_new_ops(&rows_ops, 1);
    scr_arr_push_ref(rows, row); /* moves */
    indices = scr_arr_new(SCR_ELEM_F64, 1);
    scr_arr_push_f64(indices, scr_regex_search(subject, re));
  }
  ScrStr *out = scr_str_new("", 0);
  double position = 0;
  size_t matches = (size_t)scr_arr_len(rows);
  for (size_t i = 0; i < matches && out; i++) {
    ScrArr *row = scr_arr_get_ref(rows, (double)i);
    double offset = scr_arr_get_f64(indices, (double)i);
    ScrStr *whole = scr_arr_get_ref(row, 0);
    ScrStr *replacement = scr_native_replacement(fn, row, offset, subject);
    scr_arr_release(row);
    if (!replacement) { scr_str_release(whole); scr_str_release(out); out = NULL; break; }
    out = scr_native_join(out, scr_str_slice(subject, position, offset));
    out = scr_native_join(out, replacement);
    position = offset + scr_str_utf16_len(whole);
    scr_str_release(whole);
  }
  scr_arr_release(rows);
  scr_arr_release(indices);
  if (!out) return NULL;
  out = scr_native_join(out, scr_str_slice(subject, position, scr_str_utf16_len(subject)));
  /* A global replace leaves lastIndex 0 (its last exec failed). */
  if (global) re->last_index = 0;
  return out;
}
