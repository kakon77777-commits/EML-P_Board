# -*- coding: utf-8 -*-
"""Mutation battery for the monitor-baseline-isolation candidate.

Each mutation is a way the isolation could be undone by a later edit. The gate
must go RED for every one. An anchor that does not match is NOT a pass: it is a
mutation that was never measured, and the run exits non-zero saying so — the
lesson from the 006 battery, where a CRLF/LF mismatch silently skipped C5 while
the summary still printed a total.

Usage: python mutations-baseline-iso.py <worktree>
"""
import hashlib, io, json, os, re, subprocess, sys

ROOT = sys.argv[1]
MON = os.path.join(ROOT, "scripts", "semantic-monitor.mjs")
TEST = os.path.join(ROOT, "tests", "semantic-monitor.test.ts")
GATE = "tests/semantic-monitor.test.ts"
NL = chr(10)
CRLF = chr(13) + chr(10)
KW = dict(capture_output=True, text=True, shell=True, encoding="utf-8",
          errors="replace", cwd=ROOT)

# (id, file, label, find, replace)
MUTATIONS = [
    ("M1", TEST, "runDrill stops redirecting the baseline",
     "[monitor, '--ledger', drillLedger, '--baseline', drillBaseline, ...args],",
     "[monitor, '--ledger', drillLedger, ...args],"),

    ("M2", TEST, "the drill baseline IS the committed baseline",
     "const drillBaseline = join(here, '..', 'scripts', '.monitor-test-baseline.json');",
     "const drillBaseline = join(here, '..', 'scripts', 'semantic-monitor.baseline.json');"),

    ("M3", MON, "--baseline is accepted and ignored",
     "  baselineIndex !== -1 && process.argv[baselineIndex + 1]" + NL +
     "    ? process.argv[baselineIndex + 1]" + NL +
     "    : join(here, 'semantic-monitor.baseline.json');",
     "  false" + NL +
     "    ? process.argv[baselineIndex + 1]" + NL +
     "    : join(here, 'semantic-monitor.baseline.json');"),

    ("M4", MON, "--ledger silently implies --baseline, so the flags stop being independent",
     "const baselineIndex = process.argv.indexOf('--baseline');",
     "const baselineIndex = process.argv.indexOf('--baseline') !== -1\n  ? process.argv.indexOf('--baseline')\n  : process.argv.indexOf('--ledger');"),

    ("M5", TEST, "the drill goes back to doctoring the committed baseline directly",
     "    writeFileSync(drillBaseline, doctoredText, 'utf8');",
     "    writeFileSync(drillBaseline, doctoredText, 'utf8');\n    writeFileSync(baselineFile, doctoredText, 'utf8');"),

    # M7-M10 belong to candidate 2: the edited branch's stale alert.
    ("M7", MON, "the edited branch goes back to a bare note, with no alert",
     "      alerts.push(" + NL +
     "        `STALE BASELINE    ${file} changed, and what excuses it is ${editedTests.join(', ')}",
     "      [].push(" + NL +
     "        `STALE BASELINE    ${file} changed, and what excuses it is ${editedTests.join(', ')}"),

    ("M11", MON, "the stale finding is printed but never recorded",
     "      record('monitor:alert', { kind: 'stale-baseline', file, edited: editedTests });",
     "      void editedTests;"),

    ("M8", MON, "the alert stops naming what is doing the excusing",
     "`STALE BASELINE    ${file} changed, and what excuses it is ${editedTests.join(', ')}",
     "`STALE BASELINE    ${file} changed, and something excuses it"),

    ("M9", MON, "editedTests lists every conformance test, not the differing ones",
     "    const editedTests = tests.filter(" + NL +
     "      (t) => hashes[t] !== null && seenInBaseline(t) && baseline.hashes[t] !== hashes[t]," + NL +
     "    );",
     "    const editedTests = tests.filter(" + NL +
     "      (t) => hashes[t] !== null," + NL +
     "    );"),

    ("M10", MON, "the stale finding is a note rather than an alert, so the exit code stays 0",
     "      alerts.push(" + NL +
     "        `STALE BASELINE    ${file} changed, and what excuses it is ${editedTests.join(', ')}",
     "      notes.push(" + NL +
     "        `STALE BASELINE    ${file} changed, and what excuses it is ${editedTests.join(', ')}"),

    ("M6", MON, "--accept writes the committed baseline whatever --baseline said",
     "  writeFileSync(BASELINE, JSON.stringify(current, null, 2) + '\\n', 'utf8');",
     "  writeFileSync(join(here, 'semantic-monitor.baseline.json'), JSON.stringify(current, null, 2) + '\\n', 'utf8');"),
]


def sha(p):
    return hashlib.sha256(io.open(p, "rb").read()).hexdigest()


def run_gate():
    r = subprocess.run(["npx", "vitest", "run", GATE, "--reporter=basic"], **KW)
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


pristine = {MON: io.open(MON, "rb").read(), TEST: io.open(TEST, "rb").read()}
h0 = {p: sha(p) for p in pristine}


def newline_of(b):
    return CRLF if b.count(CRLF.encode()) else NL


def anchor(text, path):
    fnl = newline_of(pristine[path])
    return text.replace(NL, fnl) if fnl != NL else text


cf, cp = run_gate()
bs, bm = baseline_state()
print("=" * 88)
print("monitor-baseline-isolation — every mutation must turn the gate RED")
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
                 ".monitor-test-only-ledger.jsonl", ".monitor-test-only-baseline.json"):
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
                   "mutations-baseline-iso.json")
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
