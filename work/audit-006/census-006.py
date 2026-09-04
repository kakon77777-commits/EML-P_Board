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
ROOT = r"D:\Ai\work together\EML"
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
    ("repr zero args",       "repr()"),
    ("repr surplus",         "repr(1, 2)"),
    ("str zero args",        "str()"),
    ("str surplus",          "str(\"a\", \"b\")"),
    ("sum zero args",        "sum()"),
    ("sum three args",       "sum([1], 0, 9)"),
    ("int zero args",        "int()"),
    ("int with base 2",      "int(\"101\", 2)"),
    ("int base rejects",     "int(\"5\", 2)"),
    ("int non-str with base", "int(1, 2)"),
    ("float zero args",      "float()"),
    ("float surplus",        "float(1, 2)"),
    ("set zero args",        "set()"),
    ("set from an iterable", "set([1, 2])"),
    ("min zero args",        "min()"),
    ("max zero args",        "max()"),
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


def classify(out):
    """(interp, cpython, verdict). Verdict distinguishes the three outcomes."""
    unsup = [l for l in out.split(NL) if '"type":"eml:unsupported"' in l or '"unsupported"' in l]
    equiv = [l for l in out.split(NL) if '"type":"eml:equiv"' in l]
    if equiv:
        ev = json.loads(equiv[0])
        a, e = (ev.get("actual") or "").strip(), (ev.get("expected") or "").strip()
        return a, e, ("MATCH" if a == e else "DIVERGE")
    # A deferral ends the run with eml:run:incomplete, not eml:run:done. Reading
    # only for `done` classified an honest defer as "no comparison", which
    # understates the interpreter: refusing to model something and silently
    # answering wrongly are the two outcomes this census exists to separate.
    if unsup:
        reason = ""
        m = re.search(r'"reason":"([^"]{0,60})', unsup[0])
        if m:
            reason = m.group(1)
        return "(defer) " + reason, "(not compared)", "DEFER"
    done = [l for l in out.split(NL) if '"type":"eml:run:done"' in l]
    if done and not json.loads(done[0]).get("ok"):
        return "(deferred)", "(not compared)", "DEFER"
    return "(no equiv event)", "(none)", "NO-COMPARE"


os.makedirs(TMP, exist_ok=True)
print("=" * 88)
print("EMLP-AUDIT-006 census - the shapes tests/builtin-shapes.test.ts never tries")
print("=" * 88)
print("%-22s %-34s %-34s %s" % ("shape", "interpreter", "real CPython", "verdict"))
rows = []
for label, call in SHAPES:
    stem = re.sub(r"[^a-z0-9]+", "_", label.lower())
    path = os.path.join(TMP, stem + ".eml")
    io.open(path, "w", encoding="utf-8", newline=NL).write(TEMPLATE % call)
    out = run(".census006/" + stem + ".eml")
    a, e, verdict = classify(out)
    rows.append({"shape": label, "call": call, "interp": a, "cpython": e, "verdict": verdict})
    print("%-22s %-34s %-34s %s" % (label[:22], a[:34], e[:34], verdict))

print()
d = sum(1 for r in rows if r["verdict"] == "DIVERGE")
m = sum(1 for r in rows if r["verdict"] == "MATCH")
f = sum(1 for r in rows if r["verdict"] == "DEFER")
n = sum(1 for r in rows if r["verdict"] == "NO-COMPARE")
print("  MATCH %d   DIVERGE %d   DEFER %d   NO-COMPARE %d   of %d shapes" % (m, d, f, n, len(rows)))
io.open(r"D:\Ai\work together\EML-P_Board\work\audit-006\census-006.json", "w",
        encoding="utf-8", newline=NL).write(json.dumps(rows, ensure_ascii=False, indent=2))
print()
print("census-006.json")
