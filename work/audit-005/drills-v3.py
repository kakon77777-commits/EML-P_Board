# -*- coding: utf-8 -*-
"""EMLP-AUDIT-005 v2 drills — eight mutations, each restoring one piece of a
pre-fix behaviour, run in the isolated worktree.

Per EMLP-RELAY-0070 §5, the handback's numbers come from THIS run: the block
this script prints under HANDBACK is the block that goes into the relay,
verbatim. v1 hand-copied its drill table from an earlier run, added three
message rows afterwards, and shipped a document whose D2 row said 4 failed
while its own drills.json said 7.

Four pairings, one per root, so a mutation cannot be excused as "some other
mechanism covered it":

    D1 / D2   the receiver is counted, and counted against ALL params
    D4 / D5   the two directions, missing and surplus
    D6 / D7   function identity at one level and at two
    D9 / D10  class identity: recorded at all, and actually consulted by the
              label rather than only by the trace - D10 is the slip that cost
              a round, where `qualifiedName` was fixed and the guard went on
              composing its own string from the bare class name
    D8        the @cold ordering, the one drill whose baseline behaviour is
              GREEN - a regression gate rather than an old red

The harness restores from a pristine copy after every drill and verifies the
file is byte-identical at the end.
"""
import hashlib, io, json, os, re, shutil, subprocess, sys

ROOT = r"D:\Ai\work together\EML-wt-audit005"
SRC = os.path.join(ROOT, "packages", "interp", "src", "index.ts")
OUT = r"D:\Ai\work together\EML-P_Board\work\audit-005"
PRISTINE = os.path.join(OUT, "_pristine-v2.ts")
GATES = ["tests/user-function-arity.test.ts",
         "tests/user-function-arity-identity.test.ts",
         "tests/user-function-arity-nesting.test.ts"]
os.chdir(ROOT)
KW = dict(capture_output=True, text=True, shell=True, encoding="utf-8", errors="replace")

METHOD_GUARD = (
    "      const arity = arityError(qualifiedName, method.params, args.length + 1);\n"
    "      if (arity) throw arity;\n"
)
CLASS_QUAL = (
    "          classQualnames.set(stmt, enclosing === undefined ? stmt.name "
    ": `${enclosing}.<locals>.${stmt.name}`);"
)
LABEL_SHARED = "      const arity = arityError(qualifiedName, method.params, args.length + 1);"
PLAIN_GUARD = "    if (arity && fn.temperature !== 'cold') throw arity;\n"
# Anchored on its own comment. The bare `if (arity) throw arity;` followed by a
# closing brace also ends the method guard, so the short form matched twice and
# D3/D8 silently did not apply — reported as -1 rather than as a red.
COLD_GUARD = (
    "      // and its signature is checked. Still above `eml:call` and the body.\n"
    "      if (arity) throw arity;\n"
)
LABEL = "arityError(qualnames.get(fn) ?? callee.name, fn.params, args.length)"
QUAL = "qualnames.set(stmt, enclosing === undefined ? stmt.name : `${enclosing}.<locals>.${stmt.name}`);"

DRILLS = [
 ("D1", "the receiver is not counted (v1's `selfParam ? 1 : 0` shape)",
  [(METHOD_GUARD,
    "      const [sp, ...rest] = method.params;\n"
    "      const arity = arityError(`${instance.className}.${method.name}`, rest, args.length + (sp ? 1 : 0) - (sp ? 1 : 0));\n"
    "      if (arity) throw arity;\n")]),

 ("D2", "the receiver is counted but compared against the params after it",
  [(METHOD_GUARD,
    "      const [, ...rest2] = method.params;\n"
    "      const arity = arityError(`${instance.className}.${method.name}`, rest2, args.length + 1);\n"
    "      if (arity) throw arity;\n")]),

 ("D3", "the plain-function frame is unguarded",
  [(PLAIN_GUARD, ""), (COLD_GUARD, "")]),

 ("D4", "the plain frame detects MISSING only",
  [(LABEL, "args.length < fn.params.length ? arityError(qualnames.get(fn) ?? callee.name, fn.params, args.length) : undefined")]),

 ("D5", "the plain frame detects SURPLUS only",
  [(LABEL, "args.length > fn.params.length ? arityError(qualnames.get(fn) ?? callee.name, fn.params, args.length) : undefined")]),

 ("D6", "the label comes from the call site rather than the function object",
  [(LABEL, "arityError(name, fn.params, args.length)")]),

 ("D7", "a nested function is not qualified",
  [(QUAL, "qualnames.set(stmt, stmt.name);")]),

 ("D8", "the @cold guard moves back above the cache (the v1 regression)",
  [(PLAIN_GUARD, "    if (arity) throw arity;\n"), (COLD_GUARD, "")]),

 ("D9", "a class definition records only its bare name (the v2 gap)",
  [(CLASS_QUAL, "          classQualnames.set(stmt, stmt.name);")]),

 ("D10", "the arity label is composed separately from qualifiedName (the v3 slip)",
  [(LABEL_SHARED,
    "      const arity = arityError(`${instance.className}.${method.name}`, method.params, args.length + 1);")]),
]


def sha(p):
    return hashlib.sha256(io.open(p, "rb").read()).hexdigest()


def run_gates():
    """(failed, passed, [failing names]) across BOTH gate files, one vitest run."""
    r = subprocess.run(["npx", "vitest", "run"] + GATES + ["--reporter=basic"], **KW)
    clean = re.sub(r"\x1b\[[0-9;]*m", "", (r.stdout or "") + (r.stderr or ""))
    m = re.search(r"Tests\s+(?:(\d+) failed\s*\|\s*)?(\d+) passed", clean)
    failed = int(m.group(1) or 0) if m else -1
    passed = int(m.group(2)) if m else -1
    names = []
    for line in clean.split("\n"):
        t = line.strip()
        if t.startswith("FAIL ") and ">" in t:
            names.append(t.split(">")[-1].strip())
    return failed, passed, names


shutil.copyfile(SRC, PRISTINE)
base = sha(SRC)
ctrl_f, ctrl_p, _ = run_gates()
print("pristine sha256 %s" % base[:16])
print("control (v3, unmutated): %d failed | %d passed\n" % (ctrl_f, ctrl_p))
if ctrl_f != 0:
    print("control is not green; every drill below would be uninterpretable")
    shutil.copyfile(PRISTINE, SRC)
    sys.exit(2)

rows = []
for did, what, subs in DRILLS:
    shutil.copyfile(PRISTINE, SRC)
    text = io.open(SRC, encoding="utf-8").read()
    ok = True
    for find, repl in subs:
        if text.count(find) != 1:
            print("!! %s anchor not unique (%d): %r" % (did, text.count(find), find[:60]))
            ok = False
            break
        text = text.replace(find, repl, 1)
    if not ok:
        rows.append((did, what, -1, -1, []))
        continue
    io.open(SRC, "w", encoding="utf-8", newline="\n").write(text)
    f, p, names = run_gates()
    rows.append((did, what, f, p, names))
    print("%s  %s\n   %d failed | %d passed" % (did, what, f, p))
    for n in names[:5]:
        print("     x %s" % n[:92])
    print()

shutil.copyfile(PRISTINE, SRC)
after = sha(SRC)
f, p, _ = run_gates()
print("restored sha256 %s   %s" % (after[:16], "IDENTICAL" if after == base else "!! DIFFERS"))
print("post-restore: %d failed | %d passed" % (f, p))
dead = [r for r in rows if r[2] == 0]
print("drills producing NO red: %s\n" % (", ".join(r[0] for r in dead) if dead else "none"))

# The block below is what goes into the relay. One run, one source.
print("=" * 66)
print("HANDBACK — copy verbatim, this is the only place these numbers exist")
print("=" * 66)
print("```")
print("control (v3, unmutated)   %d failed | %d passed" % (ctrl_f, ctrl_p))
# Distinct names on purpose: the first version reused `f` and `p`, so the
# post-restore line below printed the LAST DRILL's numbers under a heading
# that said post-restore - the exact substitution EMLP-RELAY-0070 section 5
# was about, committed inside the script written to prevent it.
for _d, _w, _f, _p, _n in rows:
    print("%-4s %-58s %d failed | %d passed" % (_d, _w[:58], _f, _p))
print("")
print("pristine sha256 %s -> restored %s  %s"
      % (base[:16], after[:16], "IDENTICAL" if after == base else "DIFFERS"))
print("post-restore gate: %d failed | %d passed" % (f, p))
print("drills producing NO red: %s" % (", ".join(r[0] for r in dead) if dead else "none"))
print("```")

io.open(os.path.join(OUT, "drills-v3.json"), "w", encoding="utf-8", newline="\n").write(
    json.dumps({"control": {"failed": ctrl_f, "passed": ctrl_p},
                "pristine_sha256": base, "restored_sha256": after,
                "post_restore": {"failed": f, "passed": p},
                "drills": [{"id": d, "restores": w, "failed": ff, "passed": pp, "failing": n}
                           for d, w, ff, pp, n in rows]}, ensure_ascii=False, indent=2))
os.remove(PRISTINE)
print("\ndrills-v2.json")
