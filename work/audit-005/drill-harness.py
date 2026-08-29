# -*- coding: utf-8 -*-
"""EMLP-AUDIT-005 drills — seven deliberate mutations, each restoring ONE piece
of the pre-patch behaviour.

Per PROTOCOL.md: actual red output is recorded, not "the drill passes", and each
drill reports how many times its MECHANISM fired rather than how many tests ran.
The mechanism counter here hangs on the guard's own output — the number of probe
programs in which an arity TypeError with CPython's message shape is raised — so
an unreached breakage point and a correctly-caught one cannot look the same.

Three pairings, for the same reason 003 paired 2/3 and 6/7:

    D1 / D2   the two parameter-binding sites are guarded SEPARATELY
    D3 / D4   the two directions (missing, surplus) are checked SEPARATELY
    D6 / D7   the guard is early enough for the RECORD and for the BODY,
              which are two different "too late"s

The harness restores from a pristine copy after every drill and verifies the
file is byte-identical at the end; a drill that leaves its defect behind would
otherwise poison every drill after it, and a `finally` that never runs has
happened here before.
"""
import hashlib, io, json, os, re, shutil, subprocess, sys

ROOT = r"D:\Ai\work together\EML"
SRC = os.path.join(ROOT, "packages", "interp", "src", "index.ts")
GATE = "tests/user-function-arity.test.ts"
OUT = r"D:\Ai\work together\EML-P_Board\work\audit-005"
PRISTINE = os.path.join(OUT, "_pristine-index.ts")
os.chdir(ROOT)
KW = dict(capture_output=True, text=True, shell=True, encoding="utf-8", errors="replace")

GUARD_620 = (
    "    const arity = arityError(name, fn.params, args.length, 0);\n"
    "    if (arity) throw arity;\n"
)
GUARD_705 = (
    "    const arity = arityError(qualifiedName, restParams, args.length, selfParam ? 1 : 0);\n"
    "    if (arity) throw arity;\n"
)
EMIT_620 = (
    "    emitter.emit('eml:call', { fn: name, args: args.map(pyRepr), "
    "temperature: fn.temperature ?? 'neutral' });\n"
)
BODY_620 = "      for (const s of fn.body) execStmt(s, local);\n"

# (id, what pre-patch behaviour it restores, [(find, replace), ...])
DRILLS = [
 ("D1", "620 unguarded — the plain function frame counts nothing",
  [(GUARD_620, "")]),

 ("D2", "705 unguarded — runMethodBody counts nothing (methods, __init__, __exit__)",
  [(GUARD_705, "")]),

 ("D3", "620 detects MISSING only — a surplus argument is still dropped",
  [("    const arity = arityError(name, fn.params, args.length, 0);\n",
    "    const arity = args.length < fn.params.length ? arityError(name, fn.params, args.length, 0) : undefined;\n")]),

 ("D4", "620 detects SURPLUS only — a missing argument is still bound to None",
  [("    const arity = arityError(name, fn.params, args.length, 0);\n",
    "    const arity = args.length > fn.params.length ? arityError(name, fn.params, args.length, 0) : undefined;\n")]),

 ("D5", "705 stops counting the bound self — right rejection, wrong numbers",
  [("arityError(qualifiedName, restParams, args.length, selfParam ? 1 : 0)",
    "arityError(qualifiedName, restParams, args.length, 0)")]),

 ("D6", "620 guard moved BELOW eml:call — right answer, and the trace records "
        "a call that never happened",
  [(GUARD_620, ""), (EMIT_620, EMIT_620 + GUARD_620)]),

 ("D7", "620 guard moved BELOW the body — right answer, after the side effects",
  [("    const arity = arityError(name, fn.params, args.length, 0);\n    if (arity) throw arity;\n",
    "    const arity = arityError(name, fn.params, args.length, 0);\n"),
   (BODY_620, BODY_620 + "      if (arity) throw arity;\n")]),
]

# Probe programs for the mechanism counter. Each SHOULD raise an arity TypeError
# when the guards are intact. The count is of guard firings, not of tests.
PROBES = [
 'def f(x):\n    return x\n\nstr(f())^0\n',
 'def f(x):\n    return x\n\nstr(f(1, 2))^0\n',
 'def f(a, b, c):\n    return a\n\nstr(f(1))^0\n',
 '@cold\ndef f(x):\n    return x\n\nstr(f(1, 2))^0\n',
 'class C:\n    def m(self, y):\n        return y\n\nC() => c\nstr(c.m())^0\n',
 'class C:\n    def m(self, y):\n        return y\n\nC() => c\nstr(c.m(1, 2))^0\n',
 'class C:\n    def __init__(self, x):\n        x => self.x\n\nC() => c\nstr(c.x)^0\n',
 'class C:\n    def __init__(self, x):\n        x => self.x\n\nC(1, 2, 3) => c\nstr(c.x)^0\n',
]
ARITY_MSG = re.compile(r"missing \d+ required positional argument|takes \d+ positional argument")


def sha(path):
    return hashlib.sha256(io.open(path, "rb").read()).hexdigest()


def mechanism_count():
    """How many probe programs the guard actually rejects, with CPython's
    message shape. Counting exceptions of ANY kind would score a broken
    interpreter as a working guard."""
    # The probe must live inside the product tree. Run from the board
    # directory, `@eml/interp` does not resolve, tsx exits ERR_MODULE_NOT_FOUND,
    # stdout is empty, and the count reads 0 — the same number a guard that
    # never fires produces. The first version of this harness did exactly that,
    # in all seven drills AND in the control, and reported it as "mechanism
    # fired 0/8" with no other sign. Only the control assertion below catches it.
    script = os.path.join(ROOT, "_mech_probe.mjs")
    io.open(script, "w", encoding="utf-8", newline="\n").write(
        "import { interpret } from '@eml/interp';\n"
        "const P = " + json.dumps(PROBES) + ";\n"
        "for (const s of P) { const r = interpret(s); "
        "console.log(JSON.stringify({ t: r.error?.type ?? null, m: r.error?.message ?? '' })); }\n"
    )
    r = subprocess.run(["npx", "tsx", script], **KW)
    os.remove(script)
    if r.returncode != 0:
        raise RuntimeError("mechanism probe did not RUN: %s" % ((r.stderr or r.stdout or "")[-220:]))
    n = 0
    for line in (r.stdout or "").split("\n"):
        line = line.strip()
        if line.startswith("{"):
            try:
                e = json.loads(line)
            except Exception:
                continue
            if e.get("t") == "TypeError" and ARITY_MSG.search(e.get("m") or ""):
                n += 1
    return n


def run_gate():
    r = subprocess.run(["npx", "vitest", "run", GATE, "--reporter=basic"], **KW)
    blob = (r.stdout or "") + (r.stderr or "")
    clean = re.sub(r"\x1b\[[0-9;]*m", "", blob)
    m = re.search(r"Tests\s+(?:(\d+) failed\s*\|\s*)?(\d+) passed", clean)
    failed = int(m.group(1) or 0) if m else -1
    passed = int(m.group(2)) if m else -1
    names = []
    for line in clean.split("\n"):
        s = line.strip()
        if s.startswith("FAIL ") and ">" in s:
            names.append(s.split(">")[-1].strip())
    return failed, passed, names


shutil.copyfile(SRC, PRISTINE)
base = sha(SRC)
print("pristine sha256 %s\n" % base[:16])

ctrl_f, ctrl_p, _ = run_gate()
ctrl_m = mechanism_count()
# A counter that cannot reach the guard reports the same 0 as a guard that
# never fires, so it must refuse rather than report. The control has to fire on
# every probe: these eight programs are all wrong-arity by construction.
if ctrl_m != len(PROBES):
    print("mechanism counter unusable: control fired %d/%d — every count below "
          "would be meaningless" % (ctrl_m, len(PROBES)))
    shutil.copyfile(PRISTINE, SRC)
    sys.exit(2)
print("## Control — patched, unmutated\n")
print("```\nTests  %d passed   red=%d   mechanism fired %d/%d probes\n```\n"
      % (ctrl_p, ctrl_f, ctrl_m, len(PROBES)))

rows = []
for did, what, subs in DRILLS:
    shutil.copyfile(PRISTINE, SRC)
    text = io.open(SRC, encoding="utf-8").read()
    applied = True
    for find, repl in subs:
        if text.count(find) != 1:
            applied = False
            print("!! %s: anchor not unique (%d) — %r" % (did, text.count(find), find[:60]))
            break
        text = text.replace(find, repl, 1)
    if not applied:
        rows.append((did, what, -1, -1, [], -1))
        continue
    io.open(SRC, "w", encoding="utf-8", newline="\n").write(text)
    f, p, names = run_gate()
    mech = mechanism_count()
    rows.append((did, what, f, p, names, mech))
    print("%s  %s" % (did, what))
    print("   Tests  %d failed | %d passed      mechanism fired %d/%d probes" % (f, p, mech, len(PROBES)))
    for n in names[:6]:
        print("     x %s" % n[:96])
    print()

shutil.copyfile(PRISTINE, SRC)
after = sha(SRC)
print("restored sha256 %s   %s" % (after[:16], "IDENTICAL" if after == base else "!! DIFFERS"))
f, p, _ = run_gate()
print("post-restore gate: %d failed | %d passed" % (f, p))

dead = [r for r in rows if r[2] == 0]
print("\ndrills that produced NO red: %s" % (", ".join(r[0] for r in dead) if dead else "none"))

# Not every drill should lower the count, and an assertion that they all must
# would be wrong about D5 and D6: those two leave the guard firing on all eight
# probes and corrupt what it REPORTS — the message and the trace. Reachability
# and discrimination are separate questions, so both are printed rather than
# collapsed into one pass/fail.
reduced = [r for r in rows if 0 <= r[5] < ctrl_m]
same = [r for r in rows if r[5] == ctrl_m]
print("drills that REDUCE guard reachability (%d/%d): %s"
      % (len(reduced), len(rows), ", ".join("%s %d/%d" % (r[0], r[5], len(PROBES)) for r in reduced)))
print("drills that keep full reachability and break what it reports: %s"
      % ", ".join("%s %d/%d" % (r[0], r[5], len(PROBES)) for r in same))
print("every drill produced red: %s" % (not dead))

io.open(os.path.join(OUT, "drills.json"), "w", encoding="utf-8", newline="\n").write(
    json.dumps({"control": {"passed": ctrl_p, "failed": ctrl_f, "mechanism": ctrl_m,
                            "probes": len(PROBES)},
                "pristine_sha256": base, "restored_sha256": after,
                "drills": [{"id": d, "restores": w, "failed": f, "passed": p,
                            "failing": n, "mechanism": m} for d, w, f, p, n, m in rows]},
               ensure_ascii=False, indent=2))
for f_ in (PRISTINE,):
    if os.path.exists(f_):
        os.remove(f_)
print("\ndrills.json")
