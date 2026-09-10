# -*- coding: utf-8 -*-
"""Mutation battery for the monitor-why-next-flag-as-reason candidate.

W1-W7 are every way the reason guard could be undone, including the two
directions the auditor named that no write-watching assertion can see: a
malformed --why that silently becomes "no reason" (exit 1 instead of 2, and a
refusal recorded on the strength of a typo), and a guard so strict it rejects a
legitimate reason.

The gate is ALL THREE monitor test files. The lower two belong to layers already
verified; they are here because this candidate changes the same script, and a
battery that ran only the new file could not see it break them.

An anchor that does not match is NOT a pass: it is a mutation that was never
measured, and the run exits non-zero saying so.

Usage: python mutations-why.py <worktree>
"""
import hashlib, io, json, os, re, subprocess, sys

ROOT = sys.argv[1]
MON = os.path.join(ROOT, "scripts", "semantic-monitor.mjs")
WHY = os.path.join(ROOT, "tests", "semantic-monitor-why.test.ts")
GATE = ("tests/semantic-monitor.test.ts tests/semantic-monitor-flags.test.ts "
        "tests/semantic-monitor-why.test.ts")
NL = chr(10)
CRLF = chr(13) + chr(10)
BQ = chr(96)
KW = dict(capture_output=True, text=True, shell=True, encoding="utf-8",
          errors="replace", cwd=ROOT)

DUP = ("    refuse(" + BQ + "${flag} was given ${at.length} times; "
       "which reason is meant is ambiguous" + BQ + ", REASON_DETAIL);")
MISSING = ("  if (value === undefined) refuse(" + BQ +
           "${flag} needs a reason, and is the last argument" + BQ + ", REASON_DETAIL);")
BLANK = ("  if (value.trim() === '') refuse(" + BQ +
         "${flag} was given an empty reason" + BQ + ", REASON_DETAIL);")

# (id, file, label, find, replace)
MUTATIONS = [
    ("W1", MON, "the known-flag guard is dropped, so --why eats the next flag",
     "  if (KNOWN_FLAGS.includes(value)) {",
     "  if (false) {"),

    ("W2", MON, "a --why with no value silently becomes 'no reason given'",
     MISSING,
     "  if (value === undefined) return '';"),

    ("W3", MON, "a duplicate --why resolves to the first instead of refusing",
     DUP,
     "    void at;"),

    ("W4", MON, "the reason is validated and then the raw argv value is used anyway",
     "const why = reasonFlag('--why');",
     "const why = (reasonFlag('--why'), process.argv[process.argv.indexOf('--why') + 1] ?? '');"),

    ("W5", MON, "the guard is over-strict and refuses a legitimate reason",
     "  if (KNOWN_FLAGS.includes(value)) {",
     "  if (true) {"),

    ("W6", MON, "one flag is dropped from the derived set, so --why --baseline passes",
     "const KNOWN_FLAGS = ['--accept', '--why', '--ledger', '--baseline'];",
     "const KNOWN_FLAGS = ['--accept', '--why', '--ledger'];"),

    ("W7", MON, "a blank reason is no longer distinguished from a missing one",
     BLANK,
     "  if (false) refuse(" + BQ + "${flag} was given an empty reason" + BQ + ", REASON_DETAIL);"),

    ("W8", WHY, "the drill baseline holds no open alert, so every cell tests a clean accept",
     "  b.hashes['packages/interp/src/values.ts'] = '0000000000000000';",
     "  void b;"),
]


def sha(p):
    return hashlib.sha256(io.open(p, "rb").read()).hexdigest()


def run_gate():
    """Returns (failed, passed, status). STATUS is the verdict; the counts are
    for the report.

    Reading the failed-count alone was wrong, and W8 is how that was found. W8
    breaks the drill setup, the file's own guard-the-guard assertion fires in
    beforeAll, and vitest then reports

        Test Files  1 failed (1)
             Tests  8 skipped (8)

    - no failed COUNT anywhere, because a file that dies in beforeAll runs no
    tests at all. The gate was red and the battery scored it NOT CAUGHT. A
    skipped file is not a passing file, and the process exit code already knew.
    Same lesson as the M2 incident in the sibling battery, in a new place: the
    instrument agreed with itself and disagreed with reality."""
    r = subprocess.run(["npx", "vitest", "run"] + GATE.split() + ["--reporter=basic"], **KW)
    o = re.sub(r"\x1b\[[0-9;]*m", "", (r.stdout or "") + (r.stderr or ""))
    m = re.search(r"Tests\s+(?:(\d+) failed\s*\|\s*)?(\d+) passed", o)
    sk = re.search(r"(\d+) skipped", o)
    failed = int(m.group(1) or 0) if m else -1
    passed = int(m.group(2)) if m else -1
    if sk and failed <= 0:
        failed = -int(sk.group(1))  # negative means "N skipped", not "N failed"
    return failed, passed, r.returncode


pristine = {MON: io.open(MON, "rb").read(), WHY: io.open(WHY, "rb").read()}
h0 = {p: sha(p) for p in pristine}


def newline_of(b):
    return CRLF if b.count(CRLF.encode()) else NL


def anchor(text, path):
    fnl = newline_of(pristine[path])
    return text.replace(NL, fnl) if fnl != NL else text


cf, cp, cs = run_gate()
print("=" * 88)
print("monitor-why-next-flag-as-reason - every mutation must turn the gate RED")
print("=" * 88)
print("  control (unmutated candidate)   %d failed | %d passed | exit %d" % (cf, cp, cs))
if cs != 0:
    print("  !! the control is not green; nothing below can be measured")
    sys.exit(1)
print()

rows, skipped, still_green = [], [], []
for mid, path, label, find, repl in MUTATIONS:
    f_a, r_a = anchor(find, path), anchor(repl, path)
    text = pristine[path].decode("utf-8")
    if text.count(f_a) != 1:
        print("  !! %-4s ANCHOR DID NOT MATCH (%d) - NOT MEASURED" % (mid, text.count(f_a)))
        rows.append({"id": mid, "label": label, "status": "NOT MEASURED"})
        skipped.append(mid)
        continue
    io.open(path, "wb").write(text.replace(f_a, r_a, 1).encode("utf-8"))
    f, p_, st = run_gate()
    io.open(path, "wb").write(pristine[path])
    damaged = subprocess.run(
        ["git", "status", "--porcelain", "--", "scripts/semantic-monitor.baseline.json",
         "scripts/semantic-monitor.jsonl"], **KW).stdout.strip()
    if damaged:
        subprocess.run(["git", "checkout", "--", "scripts/semantic-monitor.baseline.json",
                        "scripts/semantic-monitor.jsonl"], **KW)
    for junk in (".monitor-test-ledger.jsonl", ".monitor-test-baseline.json",
                 ".monitor-test-only-ledger.jsonl", ".monitor-test-only-baseline.json",
                 ".monitor-flags-ledger.jsonl", ".monitor-flags-baseline.json",
                 ".monitor-flags-duplicate.jsonl",
                 ".monitor-why-ledger.jsonl", ".monitor-why-baseline.json"):
        jp = os.path.join(ROOT, "scripts", junk)
        if os.path.exists(jp):
            os.remove(jp)
    caught = st != 0
    if not caught:
        still_green.append(mid)
    rows.append({"id": mid, "file": os.path.basename(path), "label": label,
                 "failed": f, "passed": p_, "exit": st, "status": "CAUGHT" if caught else "NOT CAUGHT",
                 "artifact_damage": damaged.replace(NL, " ; ") if damaged else ""})
    shown = ("%d failed" % f) if f > 0 else (("%d skipped" % -f) if f < 0 else "0 failed")
    print("  %-4s %-30s %-52s %-10s exit %d  %s"
          % (mid, os.path.basename(path), label[:52], shown, st,
             "CAUGHT" if caught else "NOT CAUGHT"))
    if damaged:
        print("       ^ also damaged a committed artifact: %s" % damaged.replace(NL, " ; "))

for p in pristine:
    io.open(p, "wb").write(pristine[p])
h1 = {p: sha(p) for p in pristine}
pf, pp, ps = run_gate()
print()
for p in pristine:
    print("  %-30s %s -> %s  %s" % (os.path.basename(p), h0[p][:16], h1[p][:16],
                                    "IDENTICAL" if h0[p] == h1[p] else "DIFFERS"))
print("  post-restore gate     %d failed | %d passed | exit %d" % (pf, pp, ps))
art = subprocess.run(["git", "status", "--porcelain", "--", "scripts/"], **KW).stdout.strip()
print("  committed artifacts   %s" % (art.replace(NL, " ; ") if art else "clean"))
if ps != 0 or pp != cp:
    print("  !! the post-restore control does not match the control at the top")
print("  caught %d of %d" % (len(rows) - len(skipped) - len(still_green), len(MUTATIONS)))

out = os.path.join(r"C:\Users\kakon\AppData\Local\Temp\claude\D--Ai"
                   r"\c75c2868-03b7-4e3b-ae9c-477d916d5e14\scratchpad",
                   "mutations-why.json")
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
