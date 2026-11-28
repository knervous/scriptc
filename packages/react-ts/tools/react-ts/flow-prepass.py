#!/usr/bin/env python3
"""Pre-pass over React's Flow source for Stripe's flow-to-typescript codemod (Babel 7.16's Flow parser):
rewrite the newer Flow syntax it cannot parse into forms it can, and log every rewrite so the TS post-pass
can restore the exact meaning. Usage: flow-prepass.py <packages dir> <log.json>"""
import json, pathlib, re, sys
root, log_path = pathlib.Path(sys.argv[1]), sys.argv[2]
log = []
RULES = [
    # Flow component types (`component(...props: any)`, `component()`): one named placeholder, typed in TS later.
    ("component-type", re.compile(r"\bcomponent\((?:\.\.\.props: any)?\)"), lambda m: "ReactComponentPlaceholder"),
    # A bare single arrow parameter (`cb => x`; in types, `boolean => T`) gets parentheses: the codemod annotates
    # untyped parameters but keeps the original layout, printing `cb: unknown => x`, which re-parses as something else.
    ("arrow-parens", re.compile(r"(?<![\w$.)\]'\"`])(\b(?!async\b)[A-Za-z_$][\w$]*)(\s*)=>"), lambda m: f"({m.group(1)}){m.group(2)}=>"),
    # Anonymous interface types (`interface extends Element {…}` in a union): the intersection, valid in Flow and TS.
    ("anonymous-interface", re.compile(r"\binterface extends (\w+) (\{[^{}]*\})"), lambda m: f"({m.group(1)} & {m.group(2)})"),
    # Flow `as` casts on simple operands -> the older `(x: T)` cast form.
    # Only in expression position (after `: ( , = [`), never in import/export renames or comments (filtered per line below).
    ("as-cast", re.compile(r"(?<=[:(,=\[]\s)(true|false|null|\d+(?:\.\d+)?|[A-Za-z_$][\w$]*) as ([A-Za-z_$][\w$]*(?:<[^<>\n]*>)?)(?=[,)\];\s])"), lambda m: f"({m.group(1)}: {m.group(2)})"),
    # Flow `declare` statements make the codemod skip the whole file: mark them as ordinary code it can convert,
    # restored to TypeScript `declare` forms by ts-postpass.py.
    ("declare-const", re.compile(r"^declare const (\w+)", re.M), lambda m: f"let __PrepassDeclare__{m.group(1)}"),
    # `declare class X extends Y {…}` is only ever used as a type: a Flow interface, which TypeScript takes as is.
    ("declare-class", re.compile(r"^(export )?declare class (\w+)", re.M), lambda m: f"{m.group(1) or ''}interface {m.group(2)}"),
]
# Conditional types and type-guard returns: replaced by placeholders, restored by hand in TS (listed in the log).
SPECIAL = {
    "shared/isArray.js": [("type-guard", re.compile(r"\): v is T extends \$ReadOnlyArray<mixed> \? T : empty;"), "): boolean;")],
}
OVERLOAD = re.compile(r"^declare function (\w+)(.*);\n", re.M)
for path in sorted(root.rglob("*.js")):
    rel = path.relative_to(root).as_posix()
    if "__tests__" in rel or "/server/" in rel or "__mocks__" in rel:
        continue
    text = path.read_text()
    new = text
    # `declare function f<R>(fn: () => R): R;` overload signatures: removed here, reinserted as TS overloads.
    def overload(m, rel=rel):
        log.append({"file": rel, "rule": "declare-function", "name": m.group(1), "signature": m.group(2)})
        return ""
    if rel != "shared/isArray.js":
        new = OVERLOAD.sub(overload, new)
    for name, rx, repl in RULES:
        def sub(m, name=name, repl=repl):
            before = m.string[:m.start()]
            # Inside a string literal on this line (odd count of an unescaped quote kind before the match): leave it.
            if name == "as-cast" and any(before.replace("\\" + q, "").count(q) % 2 for q in ("'", '"', "`")):
                return m.group(0)
            log.append({"file": rel, "rule": name, "from": m.group(0)})
            return repl(m)
        if name == "as-cast":
            lines = new.split("\n")
            for i, line in enumerate(lines):
                t = line.lstrip()
                if t.startswith(("import ", "export {", "export type {", "//", "*", "/*")) or " from '" in line:
                    continue
                lines[i] = rx.sub(sub, line)
            new = "\n".join(lines)
        else:
            new = rx.sub(sub, new)
    for name, rx, repl in SPECIAL.get(rel, []):
        if rx.search(new):
            log.append({"file": rel, "rule": name, "from": rx.search(new).group(0)})
            new = rx.sub(repl, new)
    if rel == "shared/ReactTypes.js":
        m = re.search(r"export type Awaited<T> = T extends null \| void[\s\S]*?;\n\n", new)
        if m:
            log.append({"file": rel, "rule": "conditional-type", "from": m.group(0)})
            new = new.replace(m.group(0), "export type Awaited<T> = T; // TS post-pass restores the conditional type\n\n")
    if new != text:
        path.write_text(new)
json.dump(log, open(log_path, "w"), indent=1)
counts = {}
for e in log: counts[e["rule"]] = counts.get(e["rule"], 0) + 1
print(counts)
