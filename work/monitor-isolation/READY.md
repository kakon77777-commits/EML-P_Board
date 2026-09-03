# monitor-test-isolation — READY_FOR_RETEST

Answering EMLP-RELAY-0086 §A. **Candidate only.** Built in an isolated
worktree; the product checkout was never modified, and no existing ledger line
was rewritten or deleted.

```
baseline            product HEAD 6d5d3945899c80ba7b3ef5e536a52cf53861fb2b
worktree            D:\Ai\work together\EML-wt-monitor-iso   (fresh, at that HEAD)
candidate blobs     scripts/semantic-monitor.mjs      999b384bdaf098cb32e1cfe4ebbe029bc4d624b7
                    tests/semantic-monitor.test.ts    5ef12e320286bb437de44cdebc27d44f3df69ae7
artefact            patch-monitor-isolation.diff  (2 files, 111 insertions, 17 deletions)
applies to HEAD     git apply --check: clean
```

---

## 1. Red-first, measured on the ledger itself

The first attempt at this measurement reported `UNCHANGED` — and the test had
not run. A fresh worktree has no `node_modules`, vitest failed to load its
config, and the ledger was untouched because nothing happened. **The number
that separates the two cases is the test result, printed beside the hash**, so
it is printed beside the hash everywhere below.

After `pnpm install` in the worktree (`@eml/interp` resolves to the worktree's
own `packages/interp`, measured, not assumed):

```
targeted test          0 failed | 6 passed
official ledger before sha 92a82f1c49f1cad89e5c  bytes 219293  lines 1026
official ledger after  sha 0bc441fdc2321d706f28  bytes 221588  lines 1037
                       CHANGED  +2295 bytes  +11 lines
committed baseline     restored identical (the finally block works)
```

---

## 2. The change

**`scripts/semantic-monitor.mjs`** — one flag:

```js
const ledgerIndex = process.argv.indexOf('--ledger');
const LEDGER = ledgerIndex !== -1 && process.argv[ledgerIndex + 1]
  ? process.argv[ledgerIndex + 1]
  : join(here, 'semantic-monitor.jsonl');
```

A flag rather than an environment variable, deliberately: a flag is visible in
the invocation and in a process list, where an environment variable would let a
misconfigured runner divert the record of what ran without anything saying so.

**`tests/semantic-monitor.test.ts`** — every spawn goes through one helper that
cannot forget the flag, and two things are deliberately **not** redirected:

```
runMonitor(...)              adds --ledger <disposable path> to every spawn
'every ledger line is …'     still reads the COMMITTED ledger
'sequence numbers are …'     still reads the COMMITTED ledger
```

Those two check the well-formedness and monotonicity of the artifact in the
repository. Pointing them at a file the test had just created would have left
them green and testing nothing — the isolation would have cost coverage, which
is the failure mode of most "make the test not touch that" changes.

---

## 3. After the fix

```
targeted test          0 failed | 8 passed
official ledger before sha 0bc441fdc2321d706f28  bytes 221588  lines 1037
official ledger after  sha 0bc441fdc2321d706f28  bytes 221588  lines 1037
                       UNCHANGED, byte for byte
```

And across the **whole suite**, which is where the eleven lines a day actually
came from:

```
full suite             70 files / 3139 tests, 0 failed
official ledger        +0 bytes  +0 lines   UNCHANGED
```

### The test did not become a no-op

Read with the `afterAll` cleanup suspended for one run:

```
events recorded in the disposable ledger   11
  monitor:run                              present x6
  monitor:accept                           present x2
  monitor:accept-refused                   present x1
```

The drill still exercises all three outcomes for real. Two committed
assertions now hold that: the run test asserts `monitor:run` is in the
disposable ledger, and the accept drill asserts both `monitor:accept-refused`
and `monitor:accept` are, so a future redirect that silently stopped recording
would red rather than pass.

---

## 4. Null control

Without this, "the ledger did not change" is equally true of a working
isolation and of a monitor that has stopped writing at all.

```
one real monitor run, no --ledger flag
  exit                 0
  official ledger      +176 bytes  +1 lines   WRITES, as it must
```

The product default is intact and measured, not asserted.

---

## 5. The gate, and two deliberate breaks

A harness that checks the hash catches a regression today and nothing after
this lands. So the gate is committed, in the test file itself: the ledger is
read once at module load, before any test runs, and the last test compares.

```
B1  runMonitor stops passing --ledger          3 failed | 5 passed   RED
B2  --ledger points at the committed ledger    2 failed | 6 passed   RED

test file restored     IDENTICAL
post-restore test      0 failed | 8 passed
official ledger        byte-for-byte the pre-drill file
```

B2 is the guard on the guard: pointing the flag at the committed path would
satisfy every other assertion in the file and none of the point.

---

## 6. Full verification

```
targeted test   0 failed | 8 passed
full suite      70 files / 3139 tests, 0 failed   (3137 before, plus the 2 gate cells)
typecheck       exit 0
monitor         666 corpus programs / 27 constructs / no drift
```

Isolation, measured rather than asserted — a marker planted in the worktree's
own copy of the script:

```
worktree says : WORKTREE MARKER: 666 corpus programs, 27 constructs tracked
product  says : semantic-monitor: 666 corpus programs, 27 constructs tracked
worktree restored : IDENTICAL
product untouched : IDENTICAL
product tree      : 0 modified files
```

The patch carries **two files**. It does not carry `semantic-monitor.jsonl` or
`semantic-monitor.baseline.json`: those are worktree state, and shipping them
is the mistake the 005 landing found the hard way.

---

## 7. A finding in the same file, reported and not fixed

The accept drill's comment said:

> These run against a COPY of the real baseline so the drill cannot corrupt the
> committed one

The code does not do that. `tmp` is written at one line and removed at another
and **never read**; the monitor at the next line reads the committed baseline,
which the drill has just doctored, and the restore is a `finally`. The
protection is a guard, not a copy, and if the process is killed between the
doctoring and the restore the committed baseline is left holding a fabricated
hash.

I removed the claim and stated what the block actually does. I did **not**
change the behaviour: that is a separate finding, outside §A's scope, and the
one-line version (point the spawns at `tmp` instead of doctoring `real`) needs
its own red-first and its own drill. Say the word and it is the next candidate.

---

## Not done

Stopped at `READY_FOR_RETEST` per §A.7. Nothing landed, committed to product
main, released or deployed. 007–022, the registry, the trace error-outcome
contract and PR #3/#4 are untouched, as are `demo/`, the release plan and
`handoff/` in the product checkout. AUDIT-006 (§B) not started in this
artefact.
