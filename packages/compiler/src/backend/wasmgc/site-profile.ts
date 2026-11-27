/* Profile-guided specialization input (experimentalJsSpecialize: "profile").
 *
 * A site profile (schema scriptc-pgo-site-profile/1, produced by
 * tests/wasmgc-react/pgo/run.sh from V8 IC logs and feedback vectors of the
 * plain-JS build of the same sources) records, per source site, what V8 saw:
 * receiver maps for property loads and stores, call targets for calls. Sites
 * are keyed by (file, span) in the compiler's SrcLoc convention, so a site is
 * found by an exact span lookup. File paths are absolute, or relative to the
 * profile's own directory (a profile committed next to its workload). A
 * profile merged over several programs (merge-profiles.mjs) tags a site
 * `entry` when the programs sharing its file saw it differently; such a site
 * applies only when compiling that entry.
 *
 * A file whose sha256 no longer matches the profile's record is stale: its
 * spans drift. Its sites are then matched by the fallback key
 * (file, fn, kind, property, ordinal) instead, where `fn` is the site's
 * innermost enclosing function. The profile records a content key per such
 * function (files[file].functions: "start:end" → sha256 prefix of the
 * function's exact text, "#k" for the k-th identical one), so `fn` resolves to
 * the function of the edited file with the same text, wherever it moved.
 * Inside an unchanged function (kind, property, ordinal) names the same
 * syntax at the same relative offset, so the site is re-based there and kept
 * when the node at the re-based span still has the site's kind and property.
 * A site whose function changed, or that lies outside any function, is
 * dropped, as is a call target whose function changed. Each stale file
 * reports how many of its sites survived.
 *
 * The emitter turns a matched site into guarded arms ahead of the unchanged
 * generic path. A guard that misses falls through to that path, so a wrong or
 * stale profile costs speed, never correctness. */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, isAbsolute, resolve } from "node:path";
import type ts from "typescript5";
import type { SrcLoc } from "../../ir/ir.js";

const require = createRequire(import.meta.url);

export const SITE_PROFILE_SCHEMA = "scriptc-pgo-site-profile/1";

export interface ProfileReceiver {
  kind: string;
  fields?: string[];
  ctor?: string;
  own?: { index: number; how?: string };
  /** A store that adds the property: `fields` is the layout before it, and
   * the new property lands at slot `index` (= fields.length). */
  transition?: { index: number };
  handler?: { kind: string };
}

export interface ProfileSpan { start: number; end: number }

export interface ProfileCallTarget {
  kind: "function" | "closure-site" | "host" | string;
  name?: string;
  file?: string;
  fn?: { name?: string; start: number; end: number };
  unresolved?: string;
}

export interface ProfileSite {
  kind: string;
  property?: string;
  file: string;
  span: ProfileSpan;
  altSpan?: ProfileSpan;
  state?: string;
  maps?: number;
  receivers?: ProfileReceiver[];
  call?: { state?: string; count?: number; targets?: ProfileCallTarget[] };
  fn?: { name?: string; start: number; end: number };
  ordinal?: number;
  fnInvocations?: number;
  /** Merged profiles: the compile entry this observation belongs to (absent: every entry). */
  entry?: string;
  /** Counted profiles (site-hits.mjs): how often the site's guard arms were
   * taken, and how often it fell through to the generic path, in a counted
   * build of the same program and profile. */
  hits?: number;
  misses?: number;
  /** Counted profiles: the guard hits inside each operation kind the counting
   * workload bracketed (mount, increment, ...), nonzero kinds only. */
  ops?: Record<string, number>;
}

export interface SiteProfileFileStatus {
  sha256: string;
  status: "current" | "stale" | "missing";
  /** Sites indexed for this file (for a stale file: the survivors). */
  sites: number;
  /** Stale files: the file's keyed sites in the profile, how many the
   * fallback key kept, and the functions they lie in (recorded, unchanged). */
  fallback?: { profiled: number; survived: number; functions: number; unchanged: number; reason?: string };
}

/** The loaded, sha-checked profile: an exact span index over current files,
 * plus the re-based survivors of stale ones. */
export interface SiteProfileIndex {
  path: string;
  sha256: string;
  files: Record<string, SiteProfileFileStatus>;
  /** Sites kept (current file, or a stale file's survivors of the fallback
   * key), of which `survived` came through the fallback key; dropped (stale
   * and not re-based, or missing file); unkeyed (no span: arithmetic
   * feedback, never looked up); and otherEntry (tagged for another program
   * of a merged profile). */
  kept: number;
  survived: number;
  dropped: number;
  unkeyed: number;
  otherEntry: number;
  /** A coverage policy (counted profiles): the fraction of counted guard hits
   * asked for, whether it was applied per operation kind or to the total, the
   * hits of all sites and of the kept ones (per operation kind too), and how
   * many sites fell below the cut (never counted ones included). */
  coverage?: { requested: number; by: "operation" | "total"; hits: number; keptHits: number; kept: number; below: number; ops?: Record<string, { hits: number; keptHits: number }> };
  /** Sites at `loc` (span or altSpan) of one of `kinds`. */
  at(loc: SrcLoc | undefined, kinds: readonly string[]): ProfileSite[];
  /** V8's representations of each field of the object layout `fields` (own
   * property names in order), over every site of this program that saw a
   * receiver with exactly that layout: "s" Smi, "d" double, "h" heap object,
   * "t" tagged. A field no site recorded is absent. */
  fieldReps(fields: readonly string[]): ReadonlyMap<string, ReadonlySet<string>>;
  /** Guard hits (1 per site when uncounted) of every site of this program that saw a plain object
   * with exactly the layout `fields` (own property names in order); 0 when none did. */
  layoutHits(fields: readonly string[]): number;
  /** The receiver layouts V8 saw at a site, before the coverage cut (current
   * files only): for paths that place no counted guard, so a counted profile
   * never kept them. */
  layoutsAt(loc: SrcLoc | undefined, kinds: readonly ProfileSite["kind"][]): ProfileSite[];
}

export class SiteProfileError extends Error {}

const spanKey = (file: string, start: number, end: number) => `${file}\0${start}:${end}`;
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

let tsModule: typeof ts | undefined;
const typescript = (): typeof ts => tsModule ??= require("typescript5") as typeof ts;
function parse(file: string, text: string): ts.SourceFile {
  const t = typescript();
  const kind = file.endsWith(".tsx") ? t.ScriptKind.TSX : file.endsWith(".ts") || file.endsWith(".mts") || file.endsWith(".cts") ? t.ScriptKind.TS : t.ScriptKind.JS;
  return t.createSourceFile(file, text, t.ScriptTarget.Latest, true, kind);
}

/** The functions of a source file as the profile producer indexes them
 * (function-like nodes with a body, span [getStart(), end)), in source order,
 * each with its content key: the first 16 hex digits of the sha256 of its
 * exact text, with "#k" appended for the k-th (k > 0) function of identical
 * text. */
export function profileFunctions(file: string, text: string, sf: ts.SourceFile = parse(file, text)): { start: number; end: number; key: string }[] {
  const t = typescript(), out: { start: number; end: number; key: string }[] = [];
  const visit = (n: ts.Node): void => {
    if (t.isFunctionLike(n) && (n as ts.FunctionLikeDeclaration).body) out.push({ start: n.getStart(sf), end: n.end, key: "" });
    t.forEachChild(n, visit);
  };
  visit(sf);
  out.sort((a, b) => a.start - b.start || b.end - a.end);
  const seen = new Map<string, number>();
  for (const f of out) {
    const h = sha256(text.slice(f.start, f.end)).slice(0, 16), k = seen.get(h) ?? 0;
    seen.set(h, k + 1);
    f.key = k ? `${h}#${k}` : h;
  }
  return out;
}

/** The profile's `files[file].functions` table: "start:end" → content key,
 * for the functions in `only` ("start:end" keys; every function if absent). */
export function profileFunctionTable(file: string, text: string, only?: Iterable<string>): Record<string, string> {
  const want = only ? new Set(only) : null, table: Record<string, string> = {};
  for (const f of profileFunctions(file, text)) { const k = `${f.start}:${f.end}`; if (!want || want.has(k)) table[k] = f.key; }
  return table;
}

/* Syntax categories at a span, the producer's (site-profile.mjs) anchors:
 * which TS node a site of each kind is keyed to, and its name. */
const CATS: Record<string, readonly string[]> = {
  load: ["prop", "iter"], "keyed-load": ["elem", "prop"], store: ["prop", "define"], define: ["define", "prop"],
  "keyed-store": ["elem", "define"], "keyed-define": ["define", "elem"], call: ["call", "construct", "iter"], construct: ["construct", "call"],
  "global-load": ["ident"], "global-store": ["ident"], in: ["in"], instanceof: ["instanceof"], "array-literal-store": ["array-elem"],
};
type SpanNodes = Map<string, { cat: string; name?: string }[]>;
function spanNodes(sf: ts.SourceFile): SpanNodes {
  const t = typescript(), out: SpanNodes = new Map();
  const add = (n: ts.Node, cat: string, name?: string) => {
    const k = `${n.getStart(sf)}:${n.end}`, l = out.get(k), e = name === undefined ? { cat } : { cat, name };
    if (l) l.push(e); else out.set(k, [e]);
  };
  const text = (n: ts.Node | undefined): string | undefined => n && (t.isIdentifier(n) || t.isStringLiteral(n) || t.isNoSubstitutionTemplateLiteral(n) || t.isNumericLiteral(n) || t.isPrivateIdentifier(n)) ? n.text : undefined;
  const visit = (n: ts.Node): void => {
    if (t.isPropertyAccessExpression(n)) add(n, "prop", n.name.text);
    else if (t.isElementAccessExpression(n)) add(n, "elem", text(n.argumentExpression));
    else if (t.isCallExpression(n)) add(n, "call");
    else if (t.isNewExpression(n)) add(n, "construct");
    else if ((t.isPropertyAssignment(n) || t.isMethodDeclaration(n) || t.isGetAccessorDeclaration(n) || t.isSetAccessorDeclaration(n)) && t.isObjectLiteralExpression(n.parent)) add(n, "define", text(n.name));
    else if (t.isShorthandPropertyAssignment(n)) add(n, "define", n.name.text);
    else if (t.isBindingElement(n) && t.isObjectBindingPattern(n.parent)) add(n, "prop", text(n.propertyName ?? n.name));
    else if (t.isBindingElement(n) && t.isArrayBindingPattern(n.parent)) add(n, "iter");
    else if (t.isIdentifier(n)) add(n, "ident", n.text);
    if (t.isArrayLiteralExpression(n)) for (const el of n.elements) add(el, "array-elem");
    if (t.isBinaryExpression(n) && (n.operatorToken.kind === t.SyntaxKind.InKeyword || n.operatorToken.kind === t.SyntaxKind.InstanceOfKeyword)) add(n, n.operatorToken.kind === t.SyntaxKind.InKeyword ? "in" : "instanceof");
    t.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** A stale file's fallback state: old function span → the span of the
 * function with the same content key in the text the compiler read. */
interface Rebase { fns: Map<string, ProfileSpan>; nodes: SpanNodes; recorded: number; reason?: string }
function rebaseFor(file: string, text: string, table: Record<string, string> | undefined): Rebase {
  if (!table || !Object.keys(table).length) return { fns: new Map(), nodes: new Map(), recorded: 0, reason: "profile records no function keys" };
  const sf = parse(file, text), byKey = new Map(profileFunctions(file, text, sf).map(f => [f.key, { start: f.start, end: f.end }]));
  const fns = new Map<string, ProfileSpan>();
  for (const [old, key] of Object.entries(table)) { const now = byKey.get(key); if (now) fns.set(old, now); }
  return { fns, nodes: spanNodes(sf), recorded: Object.keys(table).length };
}

/** Parse and index a site profile. `sourceOf(file)` returns the text the
 * compiler read for that file (undefined when it did not read it); `entry` is
 * the absolute path of the program's entry, which selects a merged profile's
 * entry-tagged sites. `coverage` (0 < c <= 1, counted profiles only) keeps
 * the hottest sites that together take that fraction of the counted guard
 * hits (of each counted operation kind's, when the counts have them), so
 * guards go only where they pay. */
export function indexSiteProfile(json: string, path: string, sourceOf: (file: string) => string | undefined, entry?: string, coverage?: number): SiteProfileIndex {
  let raw: { schema?: unknown; files?: Record<string, { sha256?: string; functions?: Record<string, string> }>; sites?: ProfileSite[]; counts?: { hits?: number; ops?: Record<string, { n?: number; hits?: number }> } };
  try { raw = JSON.parse(json); } catch (err) { throw new SiteProfileError(`site profile ${path} is not JSON: ${(err as Error).message}`); }
  if (raw.schema !== SITE_PROFILE_SCHEMA) throw new SiteProfileError(`site profile ${path} has schema ${JSON.stringify(raw.schema)}, expected ${SITE_PROFILE_SCHEMA}`);
  if (!raw.files || typeof raw.files !== "object" || !Array.isArray(raw.sites)) throw new SiteProfileError(`site profile ${path} lacks files or sites`);
  let coverageReport: SiteProfileIndex["coverage"], rawSites = raw.sites;
  if (coverage !== undefined) {
    if (!(coverage > 0 && coverage <= 1)) throw new SiteProfileError(`specialization coverage ${coverage} is not in (0, 1]`);
    if (!raw.counts) throw new SiteProfileError(`site profile ${path} has no guard counts: a coverage policy needs a counted profile (tests/wasmgc-react/pgo/site-hits.mjs)`);
    // Per operation kind when the counts have them (every timed operation
    // keeps that fraction of its own guard hits: a cheap operation's sites are
    // not crowded out by a heavy one's), else over the total. Hottest first;
    // ties keep profile order; uncounted and never-hit sites fall below any cut.
    const keep = new Set<ProfileSite>(), sites = raw.sites;
    const select = (score: (s: ProfileSite) => number) => {
      const ranked = sites.map((site, i) => ({ site, i, h: Math.max(0, score(site)) })).filter(c => c.h > 0).sort((a, b) => b.h - a.h || a.i - b.i);
      const total = ranked.reduce((sum, c) => sum + c.h, 0);
      let kept = 0;
      for (const c of ranked) { if (kept >= coverage * total) break; keep.add(c.site); kept += c.h; }
      return total;
    };
    const kinds = Object.keys(raw.counts.ops ?? {}), totals = Object.fromEntries(kinds.map(k => [k, select(s => s.ops?.[k] ?? 0)]));
    if (!kinds.length) select(s => s.hits ?? 0);
    const sum = (score: (s: ProfileSite) => number, only?: Set<ProfileSite>) => sites.reduce((n, s) => n + (!only || only.has(s) ? Math.max(0, score(s)) : 0), 0);
    coverageReport = { requested: coverage, by: kinds.length ? "operation" : "total", hits: sum(s => s.hits ?? 0), keptHits: sum(s => s.hits ?? 0, keep), kept: keep.size,
      below: sites.filter(s => s.span && !keep.has(s)).length,
      ...(kinds.length ? { ops: Object.fromEntries(kinds.map(k => [k, { hits: totals[k]!, keptHits: sum(s => s.ops?.[k] ?? 0, keep) }])) } : {}) };
    rawSites = sites.filter(s => !s.span || keep.has(s));
  }
  const base = dirname(path), abs = (file: string) => isAbsolute(file) ? file : resolve(base, file);
  // Field representations by layout, from every site of this program (the coverage cut does not apply: a layout is a layout).
  const reps = new Map<string, Map<string, Set<string>>>(), hitsByLayout = new Map<string, number>();
  for (const site of raw.sites) {
    if (site.entry !== undefined && (entry === undefined || abs(site.entry) !== entry)) continue;
    for (const r of site.receivers ?? []) {
      if (r.kind === "plain-object" && r.fields) { const k = r.fields.join("\0"); hitsByLayout.set(k, (hitsByLayout.get(k) ?? 0) + (site.hits ?? 1)); }
      const how = r.own?.how, name = r.fields?.[r.own?.index ?? -1];
      if (!how?.startsWith("field:") || name === undefined) continue;
      const key = r.fields!.join("\0");
      let byField = reps.get(key);
      if (!byField) reps.set(key, byField = new Map());
      let set = byField.get(name);
      if (!set) byField.set(name, set = new Set());
      set.add(how.slice("field:".length));
    }
  }
  const noReps: ReadonlyMap<string, ReadonlySet<string>> = new Map();
  const layoutIndex = new Map<string, ProfileSite[]>();
  const files: Record<string, SiteProfileFileStatus> = {}, rebases = new Map<string, Rebase>();
  for (const [key, rec] of Object.entries(raw.files)) {
    const file = abs(key), text = sourceOf(file);
    const status = text === undefined ? "missing" : sha256(text) === rec.sha256 ? "current" : "stale";
    files[file] = { sha256: String(rec.sha256), status, sites: 0 };
    if (status === "stale") rebases.set(file, rebaseFor(file, text!, rec.functions));
  }
  const shift = (s: ProfileSpan, d: number): ProfileSpan => ({ start: s.start + d, end: s.end + d });
  /** A stale file's site through the fallback key, or null. */
  const rebased = (site: ProfileSite, r: Rebase): ProfileSite | null => {
    const fn = site.fn, now = fn && r.fns.get(`${fn.start}:${fn.end}`);
    if (!fn || !now) return null;
    const d = now.start - fn.start, span = shift(site.span, d);
    const want = CATS[site.kind];
    const nodes = r.nodes.get(`${span.start}:${span.end}`) ?? [];
    if (!want || !nodes.some(n => want.includes(n.cat) && (site.property === undefined || n.name === undefined || n.name === site.property))) return null;
    return { ...site, span, ...(site.altSpan ? { altSpan: shift(site.altSpan, d) } : {}), fn: { ...fn, start: now.start, end: now.end } };
  };
  /** A call target's function, re-based when its file is stale. */
  const target = (t: ProfileCallTarget): ProfileCallTarget => {
    if (!t.file) return t;
    const file = abs(t.file), status = files[file]?.status;
    if (status !== "stale" || !t.fn) return file === t.file ? t : { ...t, file };
    const now = rebases.get(file)!.fns.get(`${t.fn.start}:${t.fn.end}`);
    if (now) return { ...t, file, fn: { ...t.fn, start: now.start, end: now.end } };
    const { fn: _gone, ...rest } = t;
    return { ...rest, file, unresolved: "stale" };
  };
  const index = new Map<string, ProfileSite[]>();
  let kept = 0, survived = 0, dropped = 0, unkeyed = 0, otherEntry = 0;
  for (const raw0 of rawSites) {
    if (!raw0.span) { unkeyed++; continue; }
    if (raw0.entry !== undefined && (entry === undefined || abs(raw0.entry) !== entry)) { otherEntry++; continue; }
    const file = abs(raw0.file);
    let site: ProfileSite | null = file === raw0.file ? raw0 : { ...raw0, file };
    const status = files[file];
    if (!status || status.status === "missing") { dropped++; continue; }
    if (status.status === "stale") {
      const r = rebases.get(file)!, fb = status.fallback ??= { profiled: 0, survived: 0, functions: r.recorded, unchanged: r.fns.size, ...(r.reason ? { reason: r.reason } : {}) };
      fb.profiled++;
      site = rebased(site, r);
      if (!site) { dropped++; continue; }
      fb.survived++; survived++;
    }
    if (site.call?.targets?.some(t => t.file)) site = { ...site, call: { ...site.call, targets: site.call.targets.map(target) } };
    kept++; status.sites++;
    for (const span of site.altSpan ? [site.span, site.altSpan] : [site.span]) {
      const key = spanKey(site.file, span.start, span.end);
      const list = index.get(key);
      if (list) list.push(site); else index.set(key, [site]);
    }
  }
  return {
    path, sha256: sha256(json), files, kept, survived, dropped, unkeyed, otherEntry, ...(coverageReport ? { coverage: coverageReport } : {}),
    fieldReps: fields => reps.get(fields.join("\0")) ?? noReps,
    layoutHits: fields => hitsByLayout.get(fields.join("\0")) ?? 0,
    layoutsAt(loc, kinds) {
      if (!loc) return [];
      if (!layoutIndex.size) for (const site of raw.sites ?? []) {
        if (!site.span || site.entry !== undefined && (entry === undefined || abs(site.entry) !== entry)) continue;
        const file = abs(site.file);
        if (files[file]?.status !== "current") continue;
        const key = spanKey(file, site.span.start, site.span.end), list = layoutIndex.get(key);
        if (list) list.push(site); else layoutIndex.set(key, [site]);
      }
      const list = layoutIndex.get(spanKey(loc.file, loc.start, loc.end));
      return list ? list.filter(s => kinds.includes(s.kind)) : [];
    },
    at(loc, kinds) {
      if (!loc) return [];
      const list = index.get(spanKey(loc.file, loc.start, loc.end));
      return list ? list.filter(s => kinds.includes(s.kind)) : [];
    },
  };
}

/** V8 feedback states that observed receivers (the site ran and is not megamorphic). */
export const EXECUTED_SPECIALIZABLE = new Set(["monomorphic", "polymorphic"]);
