# -*- coding: utf-8 -*-
"""monitor-test-isolation — the verification EMLP-RELAY-0086 §A asks for.

Everything below runs in the isolated worktree EML-wt-monitor-iso and nothing
touches the product checkout. Each section answers one of 0086's numbered
requirements, and every number the handback quotes is printed here.

  1  red-first     the ledger's hash and line count before and after the test
  3  after the fix official ledger unchanged; the drill ledger still records
                   run / accept / accept-refused, so the test is not a no-op
  4  null control  a real monitor run with NO flag still writes the official
                   ledger - otherwise "neither writes" would look like success
  5  breaks        two deliberate defects, each must red the new gate; restore
                   and confirm the hash

The trap this is written against: after redirecting the ledger, "the official
ledger did not change" is true both when the isolation works and when the test
never ran. Section 4 is what separates them.
"""
import hashlib, io, json, os, re, shutil, subprocess, sys

NL = chr(10)
ROOT = r"D:\Ai\work together\EML-wt-monitor-iso"
TEST = os.path.join(ROOT, "tests", "semantic-monitor.test.ts")
MJS = os.path.join(ROOT, "scripts", "semantic-monitor.mjs")
LEDGER = os.path.join(ROOT, "scripts", "semantic-monitor.jsonl")
DRILL_LEDGER = os.path.join(ROOT, "scripts", ".monitor-test-ledger.jsonl")
OUT = r"D:\Ai\work together\EML-P_Board\work\monitor-isolation"
KW = dict(capture_output=True, text=True, shell=True, encoding="utf-8", errors="replace", cwd=ROOT)


def stat(p):
    b = io.open(p, "rb").read()
    return hashlib.sha256(b).hexdigest(), len(b), b.count(bytes([10]))


def run_test():
    r = subprocess.run(["npx", "vitest", "run", "tests/semantic-monitor.test.ts", "--reporter=basic"], **KW)
    o = re.sub(r"\x1b\[[0-9;]*m", "", (r.stdout or "") + (r.stderr or ""))
    m = re.search(r"Tests\s+(?:(\d+) failed\s*\|\s*)?(\d+) passed", o)
    if not m:
        return -1, -1, o
    return int(m.group(1) or 0), int(m.group(2)), o


ORIGINAL_LEDGER = io.open(LEDGER, "rb").read()

print("=" * 76)
print("monitor-test-isolation - verification for EMLP-RELAY-0086 section A")
print("=" * 76)
print()

# ---- 3. after the fix -------------------------------------------------------
before = stat(LEDGER)
f, p, _ = run_test()
after = stat(LEDGER)
print("[3] after the fix")
print("    targeted test          %d failed | %d passed" % (f, p))
print("    official ledger before sha %s  bytes %d  lines %d" % (before[0][:20], before[1], before[2]))
print("    official ledger after  sha %s  bytes %d  lines %d" % (after[0][:20], after[1], after[2]))
print("    %s" % ("UNCHANGED, byte for byte" if before == after else "CHANGED - the isolation does not hold"))
print()

# ---- 3b. the drill ledger still records what happened ------------------------
# The test deletes its ledger in afterAll, so the cleanup is suspended for one
# run to read the evidence, then restored.
src = io.open(TEST, encoding="utf-8").read()
cleanup = "  if (existsSync(drillLedger)) rmSync(drillLedger);"
assert src.count(cleanup) == 1, "cleanup anchor not unique"
io.open(TEST, "w", encoding="utf-8", newline=NL).write(src.replace(cleanup, "  // cleanup suspended", 1))
run_test()
types = []
if os.path.exists(DRILL_LEDGER):
    for line in io.open(DRILL_LEDGER, encoding="utf-8").read().strip().split(NL):
        if line:
            types.append(json.loads(line).get("type"))
io.open(TEST, "w", encoding="utf-8", newline=NL).write(src)
if os.path.exists(DRILL_LEDGER):
    os.remove(DRILL_LEDGER)
need = ["monitor:run", "monitor:accept", "monitor:accept-refused"]
print("[3b] the drill ledger, read with cleanup suspended for one run")
print("     events recorded        %d" % len(types))
for t in need:
    print("     %-24s %s" % (t, "present x%d" % types.count(t) if t in types else "ABSENT - the test is a no-op"))
print("     ledger the drill wrote is the disposable one, and it is deleted after the run")
print()

# ---- 4. null control ---------------------------------------------------------
# The product default must still write. Without this, an isolation that broke
# the monitor entirely would produce the same "unchanged" as one that works.
nc_before = stat(LEDGER)
r = subprocess.run(["node", "scripts/semantic-monitor.mjs"], **KW)
nc_after = stat(LEDGER)
io.open(LEDGER, "wb").write(ORIGINAL_LEDGER)   # the null control wrote it; put it back
print("[4] null control - one real monitor run, no --ledger flag")
print("    exit                   %d" % r.returncode)
print("    official ledger        %+d bytes  %+d lines   %s" % (
    nc_after[1] - nc_before[1], nc_after[2] - nc_before[2],
    "WRITES, as it must" if nc_after != nc_before else "DID NOT WRITE - the default is broken"))
print()

# ---- 5. deliberate breaks ----------------------------------------------------
pristine_test = io.open(TEST, encoding="utf-8").read()
h0 = hashlib.sha256(pristine_test.encode("utf-8")).hexdigest()
BREAKS = [
    ("B1", "runMonitor stops passing --ledger",
     "return spawnSync(process.execPath, [monitor, '--ledger', drillLedger, ...args], { encoding: 'utf8' });",
     "return spawnSync(process.execPath, [monitor, ...args], { encoding: 'utf8' });"),
    ("B2", "--ledger points at the committed ledger",
     "const drillLedger = join(here, '..', 'scripts', '.monitor-test-ledger.jsonl');",
     "const drillLedger = join(here, '..', 'scripts', 'semantic-monitor.jsonl');"),
]
print("[5] deliberate breaks - each must red the gate")
ledger_backup = ORIGINAL_LEDGER
for bid, label, find, repl in BREAKS:
    if pristine_test.count(find) != 1:
        print("    %-3s anchor not unique (%d)" % (bid, pristine_test.count(find)))
        continue
    io.open(TEST, "w", encoding="utf-8", newline=NL).write(pristine_test.replace(find, repl, 1))
    bf, bp, _ = run_test()
    io.open(LEDGER, "wb").write(ledger_backup)   # a break may have written it
    print("    %-3s %-42s %d failed | %d passed  %s" % (
        bid, label, bf, bp, "RED" if bf > 0 else "DISCRIMINATES NOTHING"))
io.open(TEST, "w", encoding="utf-8", newline=NL).write(pristine_test)
io.open(LEDGER, "wb").write(ledger_backup)
h1 = hashlib.sha256(io.open(TEST, encoding="utf-8").read().encode("utf-8")).hexdigest()
lf, lp, _ = run_test()
final = stat(LEDGER)
print()
print("    test file restored     %s" % ("IDENTICAL" if h0 == h1 else "DIFFERS"))
print("    post-restore test      %d failed | %d passed" % (lf, lp))
print("    official ledger        %s" % ("byte-for-byte the pre-drill file"
                                         if hashlib.sha256(ledger_backup).hexdigest() == final[0]
                                         else "DIFFERS from the pre-drill file"))
print()

io.open(os.path.join(OUT, "drills-monitor-isolation.json"), "w", encoding="utf-8", newline=NL).write(
    json.dumps({"targeted": [f, p], "ledger_before": list(before), "ledger_after": list(after),
                "drill_ledger_types": types,
                "null_control": {"exit": r.returncode,
                                 "bytes_delta": nc_after[1] - nc_before[1],
                                 "lines_delta": nc_after[2] - nc_before[2]},
                "post_restore": [lf, lp]}, ensure_ascii=False, indent=2))
print("drills-monitor-isolation.json")
