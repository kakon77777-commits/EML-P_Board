# -*- coding: utf-8 -*-
"""EMLP-AUDIT-005 v4 — the drill battery.

Fifteen deliberate defects, each anchored on one deciding site from the census
in EMLP-RELAY-0079. A drill that reds nothing is a cell claiming coverage it
does not have; the run refuses to report a clean sheet unless every one produces
at least one red the control does not already have.

Three of them exist because of this round specifically:

    K12  the S3 ordering the census found NotMeasured — it red NOTHING before
         tests/user-function-call-order.test.ts existed
    K14  the v3 defect itself, re-added
    K15  a fix correct only for a ONE-argument construction, which the previous
         witness set scored 12/12 because every row passed one argument

The worktree is restored byte-for-byte and the hash is printed.
"""
import hashlib, io, json, os, re, shutil, subprocess, sys

NEWLINE = chr(10)
ROOT = r"D:\Ai\work together\EML-wt-audit005"
SRC = os.path.join(ROOT, "packages", "interp", "src", "index.ts")
OUT = r"D:\Ai\work together\EML-P_Board\work\audit-005"
PRISTINE = os.path.join(OUT, "_pristine-v4.ts")
JSONOUT = os.path.join(OUT, "_v4-vitest.json")
os.chdir(ROOT)
KW = dict(capture_output=True, text=True, shell=True, encoding="utf-8", errors="replace")

GATES = ["tests/user-function-arity.test.ts",
         "tests/user-function-arity-identity.test.ts",
         "tests/user-function-arity-nesting.test.ts",
         "tests/user-function-arity-constructor.test.ts",
         "tests/user-function-call-order.test.ts"]

# --- anchors, built without backslash escapes -------------------------------
S1_GUARD = "    if (arity && fn.temperature !== 'cold') throw arity;" + NEWLINE
S1_EMIT = ("    emitter.emit('eml:call', { fn: name, args: args.map(pyRepr), "
           "temperature: fn.temperature ?? 'neutral' });" + NEWLINE)
S3_GUARD = ("    {" + NEWLINE +
            "      const arity = arityError(qualifiedName, method.params, args.length + 1);" + NEWLINE +
            "      if (arity) throw arity;" + NEWLINE + "    }" + NEWLINE)
S3_PROLOGUE = ("    if (++depth > RECURSION_LIMIT) {" + NEWLINE + "      depth--;" + NEWLINE +
               "      throw new PyError('RecursionError', 'maximum recursion depth exceeded');" + NEWLINE +
               "    }" + NEWLINE + "    tick();" + NEWLINE +
               "    emitter.emit('eml:call', { fn: qualifiedName, args: args.map(pyRepr), "
               "temperature: 'neutral' });" + NEWLINE)
S3_MOVED = S3_GUARD.replace("if (arity) throw arity;", "if (arity) { depth--; throw arity; }")
S2_MSG = "`${cls.name}() takes no arguments`"

DRILLS = [
 ("K1", "S1 the plain-function frame is unguarded", S1_GUARD, ""),
 ("K2", "S1 the label comes from the call site",
  "arityError(qualnames.get(fn) ?? callee.name, fn.params, args.length)",
  "arityError(name, fn.params, args.length)"),
 ("K3", "S1 the @cold guard moves back above the cache (the v1 regression)",
  S1_GUARD, "    if (arity) throw arity;" + NEWLINE),
 ("K13", "S1 the guard fires after eml:call", [S1_GUARD, S1_EMIT],
  ["", S1_EMIT + "    if (arity && fn.temperature !== 'cold') { depth--; throw arity; }" + NEWLINE]),
 ("K4", "S2 the no-__init__ message is a literal", S2_MSG, "`BROKEN-NO-INIT-MESSAGE`"),
 ("K5", "S2 the no-__init__ message takes the method qualname rule",
  S2_MSG, "`${classQualnames.get(def) ?? cls.name}() takes no arguments`"),
 ("K11", "S2 the no-__init__ guard never rejects",
  "} else if (args.length > 0) {", "} else if (false) {"),
 ("K14", "S2 the fabricated count comes back (the v3 defect)",
  S2_MSG, "`${cls.name}() takes no arguments (${args.length} given)`"),
 ("K15", "S2 a fix correct ONLY for a one-argument construction",
  S2_MSG,
  "args.length === 1 ? `${cls.name}() takes no arguments` : "
  "`${cls.name}() takes no arguments (${args.length} given)`"),
 ("K6", "S3 the method frame is unguarded",
  "      const arity = arityError(qualifiedName, method.params, args.length + 1);" + NEWLINE +
  "      if (arity) throw arity;" + NEWLINE, ""),
 ("K7", "S3 the receiver is not counted (the v1 shape)",
  "arityError(qualifiedName, method.params, args.length + 1)",
  "arityError(qualifiedName, method.params, args.length)"),
 ("K8", "S3 the arity label is built from the bare class name",
  "    const qualifiedName = `${owner}.${method.name}`;",
  "    const qualifiedName = `${instance.className}.${method.name}`;"),
 ("K12", "S3 the guard fires after eml:call", [S3_GUARD + S3_PROLOGUE], [S3_PROLOGUE + S3_MOVED]),
 ("K9", "S4 the noun does not pluralise independently of the count",
  "missing.length === 1 ? '' : 's'", "'s'"),
 ("K10", "S4 three or more names lose the Oxford comma",
  "`${missing.slice(0, -1).join(', ')}, and ${missing[missing.length - 1]}`",
  "`${missing.join(' and ')}`"),
]


def sha(p):
    return hashlib.sha256(io.open(p, "rb").read()).hexdigest()


def run():
    """(failed, passed, {fullName of every failing cell})."""
    subprocess.run(["npx", "vitest", "run"] + GATES +
                   ["--reporter=json", "--outputFile=" + JSONOUT], **KW)
    try:
        d = json.load(io.open(JSONOUT, encoding="utf-8"))
    except Exception:
        return -1, -1, set()
    bad, good = set(), 0
    for f in d.get("testResults", []):
        for a in f.get("assertionResults", []):
            if a.get("status") == "failed":
                bad.add(a.get("fullName") or a.get("title"))
            elif a.get("status") == "passed":
                good += 1
    return len(bad), good, bad


shutil.copyfile(SRC, PRISTINE)
base = sha(SRC)
cf, cp, cset = run()
print("=" * 78)
print("EMLP-AUDIT-005 v4 drills — every number below is from this run")
print("=" * 78)
print("  control (v4, unmutated)   %d failed | %d passed" % (cf, cp))
print()
if cf != 0:
    print("  control is not green; the table below would be unreadable")
    shutil.copyfile(PRISTINE, SRC)
    sys.exit(2)

pristine_text = io.open(PRISTINE, encoding="utf-8").read()
rows = []
for did, label, find, repl in DRILLS:
    pairs = list(zip(find, repl)) if isinstance(find, list) else [(find, repl)]
    hay = pristine_text
    missing = [f for f, _ in pairs if hay.count(f) != 1]
    if missing:
        print("  !! %-4s anchor not unique (%d of %d parts)" % (did, len(missing), len(pairs)))
        rows.append((did, label, -1, []))
        continue
    for f, r_ in pairs:
        hay = hay.replace(f, r_, 1)
    io.open(SRC, "w", encoding="utf-8", newline=NEWLINE).write(hay)
    f_, _, fset = run()
    new = sorted(fset - cset)
    rows.append((did, label, len(new), new))
    print("  %-4s %-60s %3d failed" % (did, label[:60], len(new)))

shutil.copyfile(PRISTINE, SRC)
after = sha(SRC)
pf, pp, _ = run()
print()
print("  pristine sha256 %s -> restored %s  %s"
      % (base[:16], after[:16], "IDENTICAL" if after == base else "DIFFERS"))
print("  post-restore gate: %d failed | %d passed" % (pf, pp))
blind = [r[0] for r in rows if r[2] == 0]
print("  drills producing NO red: %s" % (", ".join(blind) if blind else "none"))

io.open(os.path.join(OUT, "drills-v4.json"), "w", encoding="utf-8", newline=NEWLINE).write(
    json.dumps({"control": [cf, cp], "drills": [
        {"id": a, "label": b, "new_red": c, "cells": d} for a, b, c, d in rows],
        "pristine_sha256": base, "restored_sha256": after,
        "post_restore": [pf, pp], "gates": GATES}, ensure_ascii=False, indent=2))
os.remove(PRISTINE)
if os.path.exists(JSONOUT):
    os.remove(JSONOUT)
print(NEWLINE + "drills-v4.json")
