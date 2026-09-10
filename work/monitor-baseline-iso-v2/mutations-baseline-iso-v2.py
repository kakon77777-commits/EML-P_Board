# -*- coding: utf-8 -*-
"""Mutation battery for the monitor-baseline-isolation candidate, v2.

M1-M6 are candidate 1's, re-anchored to the v2 source: the abrupt-kill hazard
and the two independent redirects. M3, M4 and M6 needed new anchors because the
two inline argv expressions they mutated no longer exist - they are now one
function, which is the whole of the v2 change.

P1-P8 are new: every way the strict path parser could be undone. P1-P4 restore
the four fail-open shapes the auditor reproduced at EMLP-RELAY-0108 and I
re-measured on 2026-09-10; P5-P7 attack the exit code and the promise that a
refusal reaches no record; P8 is the over-strict direction, which only the
positive control can catch.

M7-M11 are deliberately ABSENT. They belong to candidate 2 (the edited branch's
stale alert), which is not in this layer and restacks on it afterwards.

An anchor that does not match is NOT a pass: it is a mutation that was never
measured, and the run exits non-zero saying so.

Usage: python mutations-baseline-iso-v2.py <worktree>
"""
import hashlib, io, json, os, re, subprocess, sys

ROOT = sys.argv[1]
MON = os.path.join(ROOT, "scripts", "semantic-monitor.mjs")
TEST = os.path.join(ROOT, "tests", "semantic-monitor.test.ts")
FLAGS = os.path.join(ROOT, "tests", "semantic-monitor-flags.test.ts")
# The gate is BOTH monitor test files. The path-flag cells live in their own
# file - measured, not preferred: nine spawns in one file pushed the suite
# past a reporter RPC timeout. A battery that ran only the first file would
# report P1-P8 as NOT CAUGHT and be right for the wrong reason.
GATE = "tests/semantic-monitor.test.ts tests/semantic-monitor-flags.test.ts"
NL = chr(10)
CRLF = chr(13) + chr(10)
BQ = chr(96)
KW = dict(capture_output=True, text=True, shell=True, encoding="utf-8",
          errors="replace", cwd=ROOT)

COMMITTED_BASELINE = "join(here, 'semantic-monitor.baseline.json')"

# (id, file, label, find, replace)
MUTATIONS = [
    # ---- candidate 1: the abrupt-kill hazard and the two redirects ----
    ("M1", TEST, "runDrill stops redirecting the baseline",
     "[monitor, '--ledger', drillLedger, '--baseline', drillBaseline, ...args],",
     "[monitor, '--ledger', drillLedger, ...args],"),

    ("M2", TEST, "the drill baseline IS the committed baseline",
     "const drillBaseline = join(here, '..', 'scripts', '.monitor-test-baseline.json');",
     "const drillBaseline = join(here, '..', 'scripts', 'semantic-monitor.baseline.json');"),

    ("M3", MON, "--baseline is validated and then ignored",
     "const BASELINE = pathFlag('--baseline', " + COMMITTED_BASELINE + ");",
     "const BASELINE = (pathFlag('--baseline', " + COMMITTED_BASELINE + "), "
     + COMMITTED_BASELINE + ");"),

    ("M4", MON, "--ledger silently implies --baseline, so the flags stop being independent",
     "const BASELINE = pathFlag('--baseline', " + COMMITTED_BASELINE + ");",
     "const BASELINE = pathFlag("
     "process.argv.includes('--baseline') ? '--baseline' : '--ledger', "
     + COMMITTED_BASELINE + ");"),

    ("M5", TEST, "the drill goes back to doctoring the committed baseline directly",
     "    writeFileSync(drillBaseline, doctoredText, 'utf8');",
     "    writeFileSync(drillBaseline, doctoredText, 'utf8');" + NL
     + "    writeFileSync(baselineFile, doctoredText, 'utf8');"),

    ("M6", MON, "--accept writes the committed baseline whatever --baseline said",
     "  writeFileSync(BASELINE, JSON.stringify(current, null, 2) + '\\n', 'utf8');",
     "  writeFileSync(" + COMMITTED_BASELINE
     + ", JSON.stringify(current, null, 2) + '\\n', 'utf8');"),

    # ---- v2: the strict path parser ----
    ("P1", MON, "a flag with no path falls back to the committed artifact again",
     "  if (value === undefined) refuse("
     + BQ + "${flag} needs a path, and is the last argument" + BQ + ");",
     "  if (value === undefined) return committedDefault;"),

    ("P2", MON, "the next-flag guard is dropped, so --baseline eats --ledger",
     "  if (value.startsWith('--')) {",
     "  if (false) {"),

    ("P3", MON, "an empty path falls back to the committed artifact again",
     "  if (value.trim() === '') refuse("
     + BQ + "${flag} was given an empty path" + BQ + ");",
     "  if (value.trim() === '') return committedDefault;"),

    ("P4", MON, "a flag given twice resolves to the first instead of refusing",
     "  if (at.length > 1) {",
     "  if (false) {"),

    ("P5", MON, "a refusal exits 0, so a caller reading the status sees nothing wrong",
     "  process.exit(2);",
     "  process.exit(0);"),

    ("P6", MON, "a refusal exits 1, indistinguishable from real drift",
     "  process.exit(2);",
     "  process.exit(1);"),

    ("P7", MON, "a refusal records itself, into the committed ledger it just refused",
     "  process.exit(2);",
     "  try { appendFileSync(join(here, 'semantic-monitor.jsonl'), "
     "'{\"type\":\"monitor:refused\"}' + '\\n', 'utf8'); } catch {}" + NL
     + "  process.exit(2);"),

    ("P8", MON, "the parser refuses well-formed paths too - the over-strict direction",
     "  if (value.startsWith('--')) {",
     "  if (true) {"),

    ("P9", FLAGS, "the flags file's disposable ledger IS the committed ledger",
     "const drillLedger = join(here, '..', 'scripts', '.monitor-flags-ledger.jsonl');",
     "const drillLedger = join(here, '..', 'scripts', 'semantic-monitor.jsonl');"),
]


def sha(p):
    return hashlib.sha256(io.open(p, "rb").read()).hexdigest()


def run_gate():
    r = subprocess.run(["npx", "vitest", "run"] + GATE.split() + ["--reporter=basic"], **KW)
    o = re.sub(r"\x1b\[[0-9;]*m", "", (r.stdout or "") + (r.stderr or ""))
    m = re.search(r"Tests\s+(?:(\d+) failed\s*\|\s*)?(\d+) passed", o)
    if not m:
        # A file that does not compile is a red gate too, and must be reported
        # as such rather than as an unparsed run.
        return (-1, -1) if "Test Files" not in o else (1, 0)
    return int(m.group(1) or 0), int(m.group(2))


def baseline_state():
    p = os.path.join(ROOT, "scripts", "semantic-monitor.baseline.json")
    b = io.open(p, "rb").read()
    return hashlib.sha256(b).hexdigest()[:16], (b"0000000000000000" in b)


pristine = {MON: io.open(MON, "rb").read(), TEST: io.open(TEST, "rb").read(),
            FLAGS: io.open(FLAGS, "rb").read()}
h0 = {p: sha(p) for p in pristine}


def newline_of(b):
    return CRLF if b.count(CRLF.encode()) else NL


def anchor(text, path):
    fnl = newline_of(pristine[path])
    return text.replace(NL, fnl) if fnl != NL else text


cf, cp = run_gate()
bs, bm = baseline_state()
print("=" * 88)
print("monitor-baseline-isolation v2 - every mutation must turn the gate RED")
print("=" * 88)
print("  control (unmutated candidate)   %d failed | %d passed" % (cf, cp))
print("  committed baseline after it     %s  doctored=%s" % (bs, bm))
print()

rows, skipped, still_green = [], [], []
artifact_damage = {}
for mid, path, label, find, repl in MUTATIONS:
    f_a, r_a = anchor(find, path), anchor(repl, path)
    text = pristine[path].decode("utf-8")
    if text.count(f_a) != 1:
        print("  !! %-4s ANCHOR DID NOT MATCH (%d) - NOT MEASURED" % (mid, text.count(f_a)))
        rows.append({"id": mid, "label": label, "status": "NOT MEASURED"})
        skipped.append(mid)
        continue
    io.open(path, "wb").write(text.replace(f_a, r_a, 1).encode("utf-8"))
    f, p_ = run_gate()
    io.open(path, "wb").write(pristine[path])
    # A mutation may damage the committed ARTIFACTS as well as turn the gate
    # red, and the first version of this battery restored only the two source
    # files. M2 deleted scripts/semantic-monitor.baseline.json outright and the
    # post-restore control then failed for that reason rather than any other -
    # a battery leaving a doctored committed baseline behind, which is the
    # hazard this candidate exists to remove.
    damaged = subprocess.run(
        ["git", "status", "--porcelain", "--", "scripts/semantic-monitor.baseline.json",
         "scripts/semantic-monitor.jsonl"], **KW).stdout.strip()
    if damaged:
        subprocess.run(["git", "checkout", "--", "scripts/semantic-monitor.baseline.json",
                        "scripts/semantic-monitor.jsonl"], **KW)
    artifact_damage[mid] = damaged.replace(NL, " ; ") if damaged else ""
    for junk in (".monitor-test-ledger.jsonl", ".monitor-test-baseline.json",
                 ".monitor-test-only-ledger.jsonl", ".monitor-test-only-baseline.json",
                 ".monitor-flags-ledger.jsonl", ".monitor-flags-baseline.json",
                 ".monitor-flags-duplicate.jsonl"):
        jp = os.path.join(ROOT, "scripts", junk)
        if os.path.exists(jp):
            os.remove(jp)
    caught = f != 0
    if not caught:
        still_green.append(mid)
    rows.append({"id": mid, "file": os.path.basename(path), "label": label,
                 "failed": f, "passed": p_, "status": "CAUGHT" if caught else "NOT CAUGHT"})
    print("  %-4s %-28s %-56s %3s failed  %s"
          % (mid, os.path.basename(path), label[:56], f if f >= 0 else "n/a",
             "CAUGHT" if caught else "NOT CAUGHT"))
    if artifact_damage.get(mid):
        print("       ^ also damaged a committed artifact: %s" % artifact_damage[mid])
    rows[-1]["artifact_damage"] = artifact_damage.get(mid, "")

for p in pristine:
    io.open(p, "wb").write(pristine[p])
h1 = {p: sha(p) for p in pristine}
pf, pp = run_gate()
print()
for p in pristine:
    print("  %-28s %s -> %s  %s" % (os.path.basename(p), h0[p][:16], h1[p][:16],
                                    "IDENTICAL" if h0[p] == h1[p] else "DIFFERS"))
print("  post-restore gate     %d failed | %d passed" % (pf, pp))
art = subprocess.run(["git", "status", "--porcelain", "--", "scripts/"], **KW).stdout.strip()
print("  committed artifacts   %s" % (art.replace(NL, " ; ") if art else "clean"))
if pf != 0 or pp != cp:
    print("  !! the post-restore control does not match the control at the top")
print("  caught %d of %d" % (len(rows) - len(skipped) - len(still_green), len(MUTATIONS)))

out = os.path.join(r"C:\Users\kakon\AppData\Local\Temp\claude\D--Ai"
                   r"\c75c2868-03b7-4e3b-ae9c-477d916d5e14\scratchpad",
                   "mutations-baseline-iso-v2.json")
io.open(out, "w", encoding="utf-8", newline=NL).write(json.dumps(rows, ensure_ascii=False, indent=2))
print()
print(out)

if skipped or still_green:
    print()
    if skipped:
        print("  !! NOT MEASURED: %s - re-anchor these, they are not passes" % ", ".join(skipped))
    if still_green:
        print("  !! STILL GREEN: %s - the candidate does not guard these" % ", ".join(still_green))
    sys.exit(1)
