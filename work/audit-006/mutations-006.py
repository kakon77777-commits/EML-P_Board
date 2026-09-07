# -*- coding: utf-8 -*-
"""EMLP-AUDIT-006 — what the existing builtin gate can and cannot see.

EMLP-RELAY-0086 section B asks for mutations that make the CURRENT gate fail,
before any fix is written. Two directions are needed and only one of them is
usually run:

    CAUGHT     a defect the gate reds on. Without these the gate could be
               vacuous and every "not caught" below would mean nothing.
    NOT CAUGHT a defect the gate passes. These are the population 006 is about.

Read-only with respect to the product: every mutation is applied in the
isolated worktree EML-wt-audit006 and restored, and the restored hash is
printed. No fix is proposed here.
"""
import hashlib, io, json, os, re, shutil, subprocess, sys

NL = chr(10)
ROOT = r"D:\Ai\work together\EML-wt-audit006"
SRC = os.path.join(ROOT, "packages", "interp", "src", "index.ts")
OUT = r"D:\Ai\work together\EML-P_Board\work\audit-006"
GATE = "tests/builtin-shapes.test.ts"
KW = dict(capture_output=True, text=True, shell=True, encoding="utf-8", errors="replace", cwd=ROOT)

MUTATIONS = [
    # --- expected CAUGHT: these break shapes the gate does exercise -----------
    ("C1", "abs of a float loses its sign handling",
     "if (a.k === 'float') return FLOAT(Math.abs(a.v));",
     "if (a.k === 'float') return FLOAT(a.v);"),
    ("C2", "int stops truncating toward zero",
     "if (a.k === 'float') return INT(BigInt(Math.trunc(a.v)));",
     "if (a.k === 'float') return INT(BigInt(Math.floor(a.v)));"),
    ("C3", "min/max of one argument stops iterating it",
     "    const it = iterableItems(args[0]!);",
     "    const it = [args[0]!];"),
    ("C4", "sum stops refusing a string start",
     "        if (start.k === 'str') {",
     "        if (false) {"),
    ("C5", "len stops sharing iterableItems",
     "        const items = iterableItems(a);" + NL +
     "        if (items) return INT(BigInt(items.length));",
     "        const items = a.k === 'list' ? a.v : null;" + NL +
     "        if (items) return INT(BigInt(items.length));"),

    # --- expected NOT CAUGHT: the population this census is about -------------
    ("N1", "need() stops rejecting a missing argument at all",
     "  if (a === undefined) throw new PyError('TypeError', `${name}() missing required argument`);",
     "  if (a === undefined) return INT(0n);"),
    ("N2", "need()'s message becomes a literal",
     "`${name}() missing required argument`",
     "`BROKEN-BUILTIN-ARITY-MESSAGE`"),
    ("N3", "min/max with no arguments raises the other exception type",
     "  if (items.length === 0) throw new PyError('ValueError', `${name}() iterable argument is empty`);",
     "  if (items.length === 0) throw new PyError('TypeError', `${name}() iterable argument is empty`);"),
    ("N4", "int's ignored second argument becomes a different ignored value",
     "        const a = args[0] ?? INT(0n);",
     "        const a = args[1] ?? args[0] ?? INT(0n);"),
    ("N5", "float's zero-argument default changes",
     "        const a = args[0] ?? FLOAT(0);",
     "        const a = args[0] ?? FLOAT(1);"),
    ("N6", "set() stops refusing an iterable and silently returns empty",
     "        if (args.length > 0) throw new Unsupported('set(iterable)', 'converting an iterable to a set is not modeled yet');",
     "        if (false) throw new Unsupported('set(iterable)', 'x');"),

    # --- added for the revised census, per EMLP-RELAY-0090 section 3 ----------
    # N6 alone cannot separate the two set contracts, because one site serves
    # both: set(iterable) is a designed defer and set(a, b) should be an arity
    # error before any conversion is attempted. These two move the boundary in
    # each direction independently.
    ("N7", "set's defer moves to two arguments, so set(iterable) stops deferring",
     "        if (args.length > 0) throw new Unsupported('set(iterable)', 'converting an iterable to a set is not modeled yet');",
     "        if (args.length > 1) throw new Unsupported('set(iterable)', 'converting an iterable to a set is not modeled yet');"),
    ("N8", "set's defer becomes an arity TypeError for BOTH shapes",
     "        if (args.length > 0) throw new Unsupported('set(iterable)', 'converting an iterable to a set is not modeled yet');",
     "        if (args.length > 0) throw new PyError('TypeError', 'set expected at most 1 argument');"),

    # N4 guards the base decision. A candidate that defers or implements the
    # SECOND argument can still leave the THIRD silently consumed, so the
    # three-argument surplus needs a mutation of its own.
    ("N4b", "int silently consumes a third argument as well as a second",
     "        const a = args[0] ?? INT(0n);",
     "        const a = args[2] ?? args[0] ?? INT(0n);"),

    # str has two boundaries, not one: 2-3 arguments are a decoding/type path in
    # CPython and 4+ is true arity surplus. 0088 called str("a","b") surplus,
    # which is the wrong observable. One mutation per boundary.
    ("N9", "str returns its SECOND argument on the decoding path",
     "        const sv = need(args, 0, name);",
     "        const sv = args.length > 1 ? args[1] : need(args, 0, name);"),
    ("N10", "str's zero-argument default stops being the empty string",
     "        if (args.length === 0) return STR('');",
     "        if (args.length === 0) return STR('x');"),

    # --- added per EMLP-RELAY-0095 section 4.5 -------------------------------
    # These three are shaped as BAD FIXES rather than as regressions. A census
    # that only asks "can the gate see a break" does not ask the question a
    # candidate creates: can the gate see a fix that is too broad. Each of
    # these is what a plausible repair looks like when it overshoots.
    ("N11", "a one-argument set silently returns empty for a NON-iterable",
     "        if (args.length > 0) throw new Unsupported('set(iterable)', 'converting an iterable to a set is not modeled yet');\n        return SET([]);",
     "        if (args.length === 1 && !iterableItems(args[0])) return SET([]);\n        if (args.length > 0) throw new Unsupported('set(iterable)', 'converting an iterable to a set is not modeled yet');\n        return SET([]);"),
    ("N12", "a repr arity fix also rejects the legal single argument",
     "        const rv = need(args, 0, name);",
     "        if (args.length !== 0) throw new PyError('TypeError', `${name}() takes exactly one argument (${args.length} given)`);\n        const rv = need(args, 0, name);"),
    ("N13", "a two-argument set is silently accepted instead of deferred or refused",
     "        if (args.length > 0) throw new Unsupported('set(iterable)', 'converting an iterable to a set is not modeled yet');\n        return SET([]);",
     "        if (args.length > 1) return SET([]);\n        if (args.length > 0) throw new Unsupported('set(iterable)', 'converting an iterable to a set is not modeled yet');\n        return SET([]);"),
]


def sha(p):
    return hashlib.sha256(io.open(p, "rb").read()).hexdigest()


def run_gate():
    r = subprocess.run(["npx", "vitest", "run", GATE, "--reporter=basic"], **KW)
    o = re.sub(r"\x1b\[[0-9;]*m", "", (r.stdout or "") + (r.stderr or ""))
    m = re.search(r"Tests\s+(?:(\d+) failed\s*\|\s*)?(\d+) passed", o)
    if not m:
        return -1, -1
    return int(m.group(1) or 0), int(m.group(2))


# Binary. Reading as text and writing with newline=LF normalises a CRLF
# checkout, so the content is restored and the BYTES are not - and a hash
# comparison is a comparison of bytes.
pristine_bytes = io.open(SRC, "rb").read()
pristine = pristine_bytes.decode("utf-8")
h0 = sha(SRC)
cf, cp = run_gate()
print("=" * 84)
print("EMLP-AUDIT-006 - what tests/builtin-shapes.test.ts can see")
print("=" * 84)
print("  control (unmutated)   %d failed | %d passed" % (cf, cp))
print()
if cf != 0:
    print("  control is not green; the table below would be unreadable")
    sys.exit(2)

rows = []
# An anchor written in this file is joined with LF. The checkout is CRLF, so a
# MULTI-LINE anchor cannot match it - and on 2026-09-07 C5 silently did not,
# while the run still printed a tidy "caught 5". A skipped mutation is not
# "not caught"; it is not measured, and a battery that reports a summary over
# a skipped row is a checker reporting a count without its finding. Both are
# fixed here: anchors are rewritten to the file's own newline before matching,
# and any anchor that still fails to match makes the whole run exit non-zero.
LF = chr(10)
CRLF = chr(13) + chr(10)
FILE_NL = CRLF if pristine_bytes.count(CRLF.encode()) else LF

def anchor(t):
    return t.replace(LF, FILE_NL) if FILE_NL != LF else t

skipped = []
for mid, label, find, repl in MUTATIONS:
    find, repl = anchor(find), anchor(repl)
    if pristine.count(find) != 1:
        print("  !! %-3s ANCHOR DID NOT MATCH (%d occurrences) - NOT MEASURED"
              % (mid, pristine.count(find)))
        rows.append({"id": mid, "label": label, "failed": -1, "status": "NOT MEASURED"})
        skipped.append(mid)
        continue
    io.open(SRC, "wb").write(pristine.replace(find, repl, 1).encode("utf-8"))
    f, p = run_gate()
    rows.append({"id": mid, "label": label, "failed": f, "passed": p})
    print("  %-3s %-56s %3d failed  %s" % (mid, label[:56], f, "CAUGHT" if f > 0 else "NOT CAUGHT"))

io.open(SRC, "wb").write(pristine_bytes)
h1 = sha(SRC)
pf, pp = run_gate()
print()
print("  pristine sha256 %s -> restored %s  %s" % (h0[:16], h1[:16], "IDENTICAL" if h0 == h1 else "DIFFERS"))
print("  post-restore gate     %d failed | %d passed" % (pf, pp))
caught = [r for r in rows if r.get("failed", 0) > 0]
missed = [r for r in rows if r.get("failed") == 0]
print("  caught     %d  %s" % (len(caught), ", ".join(r["id"] for r in caught)))
print("  not caught %d  %s" % (len(missed), ", ".join(r["id"] for r in missed)))
io.open(os.path.join(OUT, "mutations-006.json"), "w", encoding="utf-8", newline=NL).write(
    json.dumps({"control": [cf, cp], "mutations": rows,
                "pristine_sha256": h0, "restored_sha256": h1,
                "post_restore": [pf, pp]}, ensure_ascii=False, indent=2))
print(NL + "mutations-006.json")

if skipped:
    print()
    print("  !! %d mutation(s) NOT MEASURED: %s" % (len(skipped), ", ".join(skipped)))
    print("  !! the caught/not-caught counts above are over a smaller population")
    print("  !! than this battery claims. Fix the anchors and re-run.")
    sys.exit(1)
