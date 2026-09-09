# -*- coding: utf-8 -*-
"""Kill the suite inside the accept drill; report what the COMMITTED baseline holds.

One instrument for both sides of the comparison. The only thing that differs
between the before and after runs is which file is watched to find the window:

  before the fix  the drill doctors the committed baseline, so watching it IS
                  watching the window
  after the fix   the drill doctors its own file, so that is what says the
                  window is open

Either way the thing REPORTED ON is the committed baseline, which is the
artifact the hazard is about.

Usage: python abrupt-kill.py <worktree> <watch-path> <label>
"""
import hashlib, io, json, os, subprocess, sys, time

ROOT, WATCH, LABEL = sys.argv[1], sys.argv[2], sys.argv[3]
COMMITTED = os.path.join(ROOT, "scripts", "semantic-monitor.baseline.json")
MARKER = b"0000000000000000"


def read(p):
    b = io.open(p, "rb").read()
    return hashlib.sha256(b).hexdigest()[:16], len(b), (MARKER in b)


def git(*a):
    r = subprocess.run(["git"] + list(a), cwd=ROOT, capture_output=True,
                       text=True, encoding="utf-8", errors="replace")
    return (r.stdout or "").strip()


before = read(COMMITTED)
print("=" * 74)
print("abrupt kill inside the accept drill  —  %s" % LABEL)
print("=" * 74)
print("watching for the window in : %s" % os.path.basename(WATCH))
print("committed baseline before  : %s  %d bytes  doctored=%s" % before)

proc = subprocess.Popen(["npx", "vitest", "run", "tests/semantic-monitor.test.ts",
                         "--reporter=basic"],
                        cwd=ROOT, shell=True,
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

deadline = time.time() + 180
caught = False
while time.time() < deadline:
    if proc.poll() is not None:
        break
    try:
        if os.path.exists(WATCH) and MARKER in io.open(WATCH, "rb").read():
            caught = True
            subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                           capture_output=True, shell=True)
            break
    except Exception:
        pass
    time.sleep(0.02)

if not caught:
    try:
        proc.wait(timeout=60)
    except Exception:
        subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                       capture_output=True, shell=True)
    print("window never observed — the run finished before the poll saw it")
else:
    time.sleep(2.0)

after = read(COMMITTED)
status = git("status", "--porcelain", "--", "scripts/semantic-monitor.baseline.json")
print()
print("KILLED INSIDE THE DRILL : %s" % caught)
print("committed baseline after: %s  %d bytes  doctored=%s" % after)
print("  unchanged             : %s" % (after[0] == before[0]))
print("  git status            : %s" % (status or "(clean)"))
if after[2]:
    d = json.load(io.open(COMMITTED, encoding="utf-8"))
    bad = [k for k, v in (d.get("hashes") or {}).items() if v == MARKER.decode()]
    print("  fabricated entries    : %s" % ", ".join(bad))

# Leave nothing behind either way.
git("checkout", "--", "scripts/semantic-monitor.baseline.json")
git("checkout", "--", "scripts/semantic-monitor.jsonl")
for junk in (".monitor-test-ledger.jsonl", ".monitor-test-baseline.json",
             ".monitor-drill-baseline.json", ".monitor-test-only-ledger.jsonl",
             ".monitor-test-only-baseline.json"):
    p = os.path.join(ROOT, "scripts", junk)
    if os.path.exists(p):
        os.remove(p)
print("cleaned up; scripts/ tracked state: %s"
      % (git("status", "--porcelain", "--", "scripts/") or "clean"))
