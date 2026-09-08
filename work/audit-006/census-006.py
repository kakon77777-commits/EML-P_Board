# -*- coding: utf-8 -*-
"""EMLP-AUDIT-006 — builtin contract census, per EMLP-RELAY-0086 section B.

Read-only with respect to the product: this writes probe programs into a temp
directory and runs the shipped CLI. No product file is modified and no fix is
proposed.

For each shape it records three things separately, because 0086 asks for them
separately and because collapsing them is how 005 took four rounds:

    acceptance   does the interpreter accept, reject, or defer
    message      the exact str(e) when it rejects, against real CPython's
    defer        an Unsupported is a legitimate third outcome, not a failure

The comparison against CPython is made here, from the two sides of eml:equiv,
rather than by reading the CLI's `ok` flag.
"""
import io, json, os, re, subprocess, sys

NL = chr(10)
# The tree under measurement. Defaults to the product; pass a worktree path
# to measure a candidate with the SAME harness, so the two numbers are
# comparable by construction rather than by assertion.
ROOT = sys.argv[1] if len(sys.argv) > 1 else r"D:\Ai\work together\EML"
# The output is named after WHAT WAS MEASURED, not after this script. Writing a
# fixed census-006.json made the committed artifact describe whichever run
# happened last: EMLP-RELAY-0102 found the v1 snapshot sitting under a generic
# name beside prose claiming v2's numbers. A file whose name does not say which
# tree it came from will eventually be read as the tree the reader expects.
LABEL = sys.argv[2] if len(sys.argv) > 2 else os.path.basename(ROOT.rstrip("\\/")).lower()
TMP = os.path.join(ROOT, ".census006")
KW = dict(capture_output=True, text=True, shell=True, encoding="utf-8", errors="replace", cwd=ROOT)

# label, the call as EML source. Every one is wrapped so that a raised exception
# becomes stdout, which is the only way the MESSAGE reaches the comparison; a
# row that prints the exception's type name would pass on any message at all.
SHAPES = [
    ("abs zero args",        "abs()"),
    ("abs surplus",          "abs(1, 2)"),
    ("len zero args",        "len()"),
    ("len surplus",          "len([1], 2)"),
    ("repr one arg legal",   "repr(42)"),
    ("repr zero args",       "repr()"),
    ("repr surplus",         "repr(1, 2)"),
    ("str zero args",        "str()"),
    ("str one arg legal",    "str(\"a\")"),
    ("str two args",         "str(\"a\", \"b\")"),
    ("str three args",       "str(\"a\", \"b\", \"c\")"),
    ("str four args",        "str(\"a\", \"b\", \"c\", \"d\")"),
    ("sum zero args",        "sum()"),
    ("sum three args",       "sum([1], 0, 9)"),
    ("int zero args",        "int()"),
    ("int one arg legal",    "int(\"10\")"),
    ("int with base 2",      "int(\"101\", 2)"),
    ("int three args",       "int(\"10\", 2, 3)"),
    ("int base rejects",     "int(\"5\", 2)"),
    ("int non-str with base", "int(1, 2)"),
    ("float zero args",      "float()"),
    ("float surplus",        "float(1, 2)"),
    ("set zero args",        "set()"),
    ("set from an iterable", "set([1, 2])"),
    ("set one non-iterable", "set(1)"),
    ("set two args",         "set(1, 2)"),
    ("min zero args",        "min()"),
    ("max zero args",        "max()"),
    ("min empty iterable",   "min([])"),
    ("max empty iterable",   "max([])"),

    # class-protocol rows, per EMLP-RELAY-0100
    ('instance, no protocol', 'class Plain:\n    def hello(self):\n        return 1\n\nPlain() => p\ntry:\n    str(len(set(p)))^0\nexcept TypeError as e:\n    "TypeError: " + str(e)^0\n'),
    ('instance, __len__ only', 'class Sized:\n    def __len__(self):\n        return 3\n\nSized() => z\ntry:\n    str(len(set(z)))^0\nexcept TypeError as e:\n    "TypeError: " + str(e)^0\n'),
    ('instance, __iter__', 'class EmptyIter:\n    def __iter__(self):\n        return self\n    def __next__(self):\n        raise StopIteration()\n\nEmptyIter() => it\ntry:\n    str(len(set(it)))^0\nexcept TypeError as e:\n    "TypeError: " + str(e)^0\n'),
    ('instance, __getitem__', 'class Seq:\n    def __getitem__(self, i):\n        if i < 3:\n            return i\n        raise IndexError()\n\nSeq() => s\ntry:\n    str(len(set(s)))^0\nexcept TypeError as e:\n    "TypeError: " + str(e)^0\n'),
    ('instance, bound attr', 'class Assigned:\n    def marker(self):\n        return 0\n\ndef pick(self, i):\n    if i < 2:\n        return i\n    raise IndexError()\n\npick => Assigned.__getitem__\nAssigned() => a\ntry:\n    str(len(set(a)))^0\nexcept TypeError as e:\n    "TypeError: " + str(e)^0\n'),
]

TEMPLATE = ("try:" + NL +
            "    str(%s)^0" + NL +
            "except TypeError as e:" + NL +
            "    \"TypeError: \" + str(e)^0" + NL +
            "except ValueError as e:" + NL +
            "    \"ValueError: \" + str(e)^0" + NL)


def run(rel):
    r = subprocess.run(["npx", "tsx", "packages/cli/src/index.ts", "trace", "--run", rel], **KW)
    out = NL.join(l for l in ((r.stdout or "") + (r.stderr or "")).split(NL)
                  if not l.startswith("npm warn"))
    return out


def run_cpython(rel):
    """CPython's answer, obtained WITHOUT the interpreter.

    `eml run` transpiles and executes via real python, so it still answers for a
    shape the interpreter defers on. Before EMLP-RELAY-0095 this census wrote
    "(not compared)" in the CPython column of every defer row - which is a fact
    about the harness (no eml:equiv event was emitted) reported as if it were a
    fact about the contract. A missing oracle is not an absent obligation.
    """
    r = subprocess.run(["npx", "tsx", "packages/cli/src/index.ts", "run", rel], **KW)
    out = NL.join(l for l in ((r.stdout or "") + (r.stderr or "")).split(NL)
                  if l.strip() and not l.startswith("npm warn"))
    return out.strip()


# Deferring is legitimate only where it is a stated design decision. Everything
# else that defers is deferring by accident, and the two must not share a row
# type: one is a documented boundary, the other is a defect wearing its costume.
# Fixed by EMLP-RELAY-0097 section 2: int at exactly two arguments and str at
# exactly two or three are honest deferrals, not implementations. Six
# equivalence classes in this population. Everything else that defers is
# deferring by accident.
AUTHORIZED_DEFER = {
    "set from an iterable",
    "int with base 2", "int base rejects", "int non-str with base",
    "str two args", "str three args",
    "instance, __iter__", "instance, __getitem__", "instance, bound attr",
}


def classify(out, label, rel):
    """(interp, cpython, outcome, authorized).

    Two axes, deliberately. `outcome` is what the run did; `authorized` is
    whether that is allowed. Collapsing them into one MATCH/DIVERGE/DEFER total
    lets an unexpected defer be counted as though it were a designed one.
    """
    unsup = [l for l in out.split(NL) if '"type":"eml:unsupported"' in l or '"unsupported"' in l]
    equiv = [l for l in out.split(NL) if '"type":"eml:equiv"' in l]
    if equiv:
        ev = json.loads(equiv[0])
        a, e = (ev.get("actual") or "").strip(), (ev.get("expected") or "").strip()
        ok = a == e
        return a, e, ("MATCH" if ok else "DIVERGE"), ("OK" if ok else "DEFECT")
    # A deferral ends the run with eml:run:incomplete, not eml:run:done. Reading
    # only for `done` classified an honest defer as "no comparison", which
    # understates the interpreter: refusing to model something and silently
    # answering wrongly are the two outcomes this census exists to separate.
    deferred = bool(unsup)
    if not deferred:
        done = [l for l in out.split(NL) if '"type":"eml:run:done"' in l]
        deferred = bool(done) and not json.loads(done[0]).get("ok")
    if deferred:
        reason = ""
        if unsup:
            m = re.search(r'"reason":"([^"]{0,60})', unsup[0])
            if m:
                reason = m.group(1)
        designed = label in AUTHORIZED_DEFER
        return ("(defer) " + reason,
                run_cpython(rel),
                "DESIGNED_DEFER" if designed else "UNEXPECTED_DEFER",
                "OK" if designed else "DEFECT")
    return "(no equiv event)", "(none)", "NO-COMPARE", "DEFECT"


os.makedirs(TMP, exist_ok=True)
print("=" * 88)
print("EMLP-AUDIT-006 census - the shapes tests/builtin-shapes.test.ts never tries")
print("=" * 88)
print("%-22s %-32s %-32s %-17s %s" % ("shape", "interpreter", "real CPython", "outcome", "allowed"))
rows = []
for label, call in SHAPES:
    stem = re.sub(r"[^a-z0-9]+", "_", label.lower())
    path = os.path.join(TMP, stem + ".eml")
    # A shape may be a whole PROGRAM rather than a call: the class-protocol
    # rows added for EMLP-RELAY-0100 need a class definition, which the
    # single-expression template cannot carry.
    src = call if NL in call else TEMPLATE % call
    io.open(path, "w", encoding="utf-8", newline=NL).write(src)
    rel = ".census006/" + stem + ".eml"
    out = run(rel)
    a, e, outcome, allowed = classify(out, label, rel)
    rows.append({"shape": label, "call": call, "interp": a, "cpython": e,
                 "outcome": outcome, "authorized": allowed})
    print("%-22s %-32s %-32s %-17s %s" % (label[:22], a[:32], e[:32], outcome, allowed))

print()
# Raw outcomes: what the runs did. Kept, because it is the measurement.
counts = {}
for r in rows:
    counts[r["outcome"]] = counts.get(r["outcome"], 0) + 1
print("  raw outcomes   " + "   ".join("%s %d" % (k, counts[k]) for k in sorted(counts)))
# Closure: whether each outcome is allowed. This is the axis a candidate has to
# move, and it is NOT the axis above: a defer that nobody designed is a defect
# that happens to have deferred.
ok = sum(1 for r in rows if r["authorized"] == "OK")
bad = len(rows) - ok
print("  closure        OK %d   DEFECT %d   of %d shapes" % (ok, bad, len(rows)))
print()
print("  designed defers   : " + ", ".join(r["shape"] for r in rows if r["outcome"] == "DESIGNED_DEFER"))
print("  unexpected defers : " + ", ".join(r["shape"] for r in rows if r["outcome"] == "UNEXPECTED_DEFER"))
OUTNAME = "census-006-" + LABEL + ".json"
io.open(os.path.join(r"D:\Ai\work together\EML-P_Board\work\audit-006", OUTNAME), "w",
        encoding="utf-8", newline=NL).write(json.dumps(rows, ensure_ascii=False, indent=2))
print()
print(OUTNAME)
