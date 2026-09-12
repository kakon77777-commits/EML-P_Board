# -*- coding: utf-8 -*-
"""Mutation battery for the monitor-stale-baseline-edited-branch candidate,
restacked on the verified path-flag + --why stack (2049ff1).

E1-E5 are candidate 2's original M7-M11 re-anchored to the current monitor: the
edited branch must raise a STALE BASELINE alert (not a bare note), name only the
tests that actually differ, exit non-zero, and record the finding.

E6 is NEW: the `unseen` branch's own record('monitor:alert', …) — carried since
2026-08-09 with no test asserting it, raised at relays 0108/0115/0116 — now has
a cell, and this mutation proves that cell bites.

The gate is ALL THREE monitor test files. Score is the process exit code, not a
failed-count (the W8 lesson): a file that dies in beforeAll reports skipped, not
failed. Committed artifacts are restored per row (the M2 lesson).

Usage: python mutations-edited.py <worktree>
"""
import hashlib, io, os, re, subprocess, sys

ROOT = sys.argv[1]
MON = os.path.join(ROOT, "scripts", "semantic-monitor.mjs")
DRILL = os.path.join(ROOT, "tests", "semantic-monitor.test.ts")
GATE = ("tests/semantic-monitor.test.ts tests/semantic-monitor-flags.test.ts "
        "tests/semantic-monitor-why.test.ts")
NL = chr(10)
CRLF = chr(13) + chr(10)
BQ = chr(96)
KW = dict(capture_output=True, text=True, shell=True, encoding="utf-8",
          errors="replace", cwd=ROOT)

EDIT_FILTER = (
    "      (t) => hashes[t] !== null && seenInBaseline(t) && baseline.hashes[t] !== hashes[t],")
EDIT_ALERT_NAME = (
    BQ + "STALE BASELINE    ${file} changed, and what excuses it is ${editedTests.join(', ')}")
EDIT_RECORD = (
    "      record('monitor:alert', { kind: 'stale-baseline', file, edited: editedTests });")
UNSEEN_RECORD = (
    "      record('monitor:alert', { kind: 'stale-baseline', file, unseen });")
EDIT_NOTE_THEN_ALERT = (
    "      notes.push(" + BQ + "${file} changed, and so did its conformance test — reviewed" + BQ + ");" + NL +
    "      alerts.push(")

MUTATIONS = [
    ("E1", MON, "edited detection is disabled, so a stale pair is not flagged",
     "    const edited = editedTests.length > 0;",
     "    const edited = false;"),

    ("E2", MON, "editedTests lists every paired test, not only the differing ones",
     EDIT_FILTER,
     "      (t) => hashes[t] !== null,"),

    ("E3", MON, "the edited finding is printed but never recorded",
     EDIT_RECORD,
     "      void editedTests;"),

    ("E4", MON, "the unseen finding is printed but never recorded (the fourth-time assertion)",
     UNSEEN_RECORD,
     "      void unseen;"),

    ("E5", MON, "the edited alert stops naming what is doing the excusing",
     EDIT_ALERT_NAME,
     BQ + "STALE BASELINE    ${file} changed, and something excuses it"),

    ("E6", MON, "the edited finding is a note not an alert, so the exit code stays 0",
     EDIT_NOTE_THEN_ALERT,
     "      notes.push(" + BQ + "${file} changed, and so did its conformance test — reviewed" + BQ + ");" + NL +
     "      notes.push("),
]


def sha(p):
    return hashlib.sha256(io.open(p, "rb").read()).hexdigest()


def run_gate():
    r = subprocess.run(["npx", "vitest", "run"] + GATE.split() + ["--reporter=basic"], **KW)
    o = re.sub(r"\x1b\[[0-9;]*m", "", (r.stdout or "") + (r.stderr or ""))
    m = re.search(r"Tests\s+(?:(\d+) failed\s*\|\s*)?(\d+) passed", o)
    sk = re.search(r"(\d+) skipped", o)
    failed = int(m.group(1) or 0) if m else -1
    passed = int(m.group(2)) if m else -1
    if sk and failed <= 0:
        failed = -int(sk.group(1))
    return failed, passed, r.returncode


pristine = {MON: io.open(MON, "rb").read(), DRILL: io.open(DRILL, "rb").read()}
h0 = {p: sha(p) for p in pristine}


def newline_of(b):
    return CRLF if b.count(CRLF.encode()) else NL


def anchor(text, path):
    fnl = newline_of(pristine[path])
    return text.replace(NL, fnl) if fnl != NL else text


cf, cp, cs = run_gate()
print("=" * 88)
print("monitor-stale-baseline-edited-branch - every mutation must turn the gate RED")
print("=" * 88)
print("  control (unmutated candidate)   %d failed | %d passed | exit %d" % (cf, cp, cs))
if cs != 0:
    print("  !! the control is not green; nothing below can be measured")
    sys.exit(1)
print()

rows, skipped, still_green, caught_n = [], [], [], 0
for mid, path, label, find, repl in MUTATIONS:
    f_a, r_a = anchor(find, path), anchor(repl, path)
    text = pristine[path].decode("utf-8")
    if text.count(f_a) != 1:
        print("  !! %-4s ANCHOR DID NOT MATCH (%d) - NOT MEASURED" % (mid, text.count(f_a)))
        rows.append(mid)
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
                 ".monitor-flags-duplicate.jsonl", ".monitor-why-ledger.jsonl",
                 ".monitor-why-baseline.json"):
        jp = os.path.join(ROOT, "scripts", junk)
        if os.path.exists(jp):
            os.remove(jp)
    caught = st != 0
    rows.append(mid)
    if caught:
        caught_n += 1
    else:
        still_green.append(mid)
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
print("  caught %d of %d" % (caught_n, len(MUTATIONS)))

if skipped or still_green:
    print()
    if skipped:
        print("  !! NOT MEASURED: %s" % ", ".join(skipped))
    if still_green:
        print("  !! STILL GREEN: %s" % ", ".join(still_green))
    sys.exit(1)
