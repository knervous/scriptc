#!/usr/bin/env python3
"""Post-pass over the converted, flag-folded TypeScript: restores what flow-prepass.py marked (declare forms,
overloads, placeholders) and applies exact fixes for codemod mistakes. Usage: ts-postpass.py <folded dir> <prepass-log.json>"""
import json, pathlib, re, sys
root, log = pathlib.Path(sys.argv[1]), json.load(open(sys.argv[2]))
applied = 0
def edit(rel, fn):
    global applied
    p = root / (rel[:-3] + ".ts")
    if not p.exists(): return
    t = p.read_text(); n = fn(t)
    if n != t: p.write_text(n); applied += 1
for p in root.rglob("*.ts"):
    t = p.read_text()
    n = re.sub(r"\blet __PrepassDeclare__(\w+)", r"declare var \1", t)
    n = re.sub(r"\bclass __PrepassDeclare__(\w+)", r"declare class \1", n)
    if n != t: p.write_text(n); applied += 1
# Overloads: TS overload signatures right before the implementation.
def ts_sig(sig):
    return sig.replace("(void)", "()")
by_file = {}
for e in log:
    if e["rule"] == "declare-function": by_file.setdefault(e["file"], []).append(e)
for rel, entries in by_file.items():
    def add(t, entries=entries):
        for name in dict.fromkeys(e["name"] for e in entries):
            sigs = "".join(f"function {name}{ts_sig(e['signature'])};\n" for e in entries if e["name"] == name)
            m = re.search(rf"^(export )?function {name}\b", t, re.M)
            if not m: print(f"overload target missing: {rel} {name}"); continue
            exp = m.group(1) or ""
            sigs = "".join(f"{exp}{line}\n" for line in sigs.strip().split("\n"))
            t = t[:m.start()] + sigs + t[m.start():]
        return t
    edit(rel, add)
# isArray: the type guard the pre-pass parked.
edit("shared/isArray.js", lambda t: re.sub(r"\): boolean;", "): v is Extract<T, readonly unknown[]>;", t, count=1))
print(f"post-pass: {applied} files changed")
