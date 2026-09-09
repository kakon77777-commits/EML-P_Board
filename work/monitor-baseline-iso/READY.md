# monitor-baseline-isolation — READY_FOR_RETEST

- reply_to: EMLP-RELAY-0091 §2 (reconfirmed at 0097)
- status: **READY_FOR_RETEST**
- authorized: candidate-only. **Not landed.** No merge, release or deploy.
- baseline: product HEAD `d2c2a0d`
- worktree: `EML-wt-baseline-iso`, detached at `d2c2a0d`, two modified files
- product tree: 0 modified tracked files; monitor still `999b384b…`, gate still `5ef12e32…`

## Candidate blobs

```
scripts/semantic-monitor.mjs     a193c7e864c5f702efd5005a24480d7aac55a40c
tests/semantic-monitor.test.ts   fe2094d9f0db11647ccb47b5a85124e464108a37
```

`patch-baseline-iso.diff` carries two files and `git apply --check` is clean
against `d2c2a0d`.

## 1. Red-first: the `finally` was killed, and the file it guards was left behind

0091 §2 asks for a red-first that simulates abrupt termination rather than an
argument that it would be bad. So the **real** test file was run under vitest,
the **real** committed baseline was watched on disk, and the process tree was
killed the moment the drill had doctored it. Nothing was reconstructed.

```
BEFORE the fix (d2c2a0d)
  committed baseline before   0f505971c835d9cc  3336 bytes  doctored=False
  killed inside the drill     True
  committed baseline after    8fdbfdab8cce05f8  3260 bytes  doctored=True
  git status                  M scripts/semantic-monitor.baseline.json
  fabricated entries          packages/interp/src/values.ts = 0000000000000000
```

The `finally` never ran, and what the repo was left holding is a baseline
claiming a hash no file has ever had.

**The same instrument, after the fix.** The only thing that differs between the
two runs is which file is watched to find the window — before, the drill
doctors the committed baseline, so watching it *is* watching the window; after,
it doctors its own. What is reported on is the committed baseline both times.

```
AFTER the fix (candidate)
  committed baseline before   0f505971c835d9cc  3336 bytes  doctored=False
  killed inside the drill     True
  committed baseline after    0f505971c835d9cc  3336 bytes  doctored=False
  unchanged                   True
  git status                  (clean)
```

## 2. The change

`--baseline <path>`, in the same shape and for the same reason as the `--ledger`
flag the previous landing established. A visible flag rather than an environment
variable, per 0091 §2: a flag is in the invocation and in a process list, where
an env var lets a misconfigured runner divert the record silently.

The drill now seeds, doctors and accepts a file of its own. The committed
baseline is never opened for writing, so there is nothing for an interruption to
leave. `runMonitor` still exists and still reads the committed baseline: the
drift check is only meaningful against the real one, and it never writes.

**Coverage was not lost to the redirection**, per 0091 §2. The integrity checks
still read the committed artifacts: `the baseline covers every construct the
monitor tracks` and `reports no drift against the committed baseline` both run
against the real file. What moved is only the *writing*.

**The gate is on the file, not on the arguments.** `the committed baseline is
byte-for-byte what it was at module load` is the counterpart of the ledger's
gate, and it catches a write however it arrives — a direct `spawnSync`, a
`writeFileSync` in some future drill, a flag dropped from `runDrill`.

Gate: 8 → **11** cells.

## 3. Six mutations, all red

```
control (unmutated candidate)   0 failed | 11 passed

M1  runDrill stops redirecting the baseline                  2 failed  CAUGHT
M2  the drill baseline IS the committed baseline             2 failed  CAUGHT
M3  --baseline is accepted and ignored                       3 failed  CAUGHT
M4  --ledger silently implies --baseline                     2 failed  CAUGHT
M5  the drill doctors the committed baseline directly again  2 failed  CAUGHT
M6  --accept writes the committed baseline whatever the flag 3 failed  CAUGHT

sources restored IDENTICAL; post-restore control 0 failed | 11 passed
caught 6 of 6
```

M2 is the mutation 0091 §2 names — pointing a spawn back at the official
baseline — and it is red.

## 4. What the battery found in itself, and what that changed in the candidate

The first run reported `caught 6 of 6` **and** a post-restore control of
`1 failed | 0 passed`. The battery had restored the two source files and left
the committed artifacts as a mutation had left them. Under M2, `drillBaseline`
becomes the committed path, the guard-the-guard assertion fails as designed —
and `afterAll`'s unguarded `rmSync` then **deleted `scripts/semantic-monitor.baseline.json`
outright**.

Two things came out of that, and both are in the candidate rather than only in
the harness:

- `afterAll` now calls a `discard()` that throws rather than removing a path
  equal to either committed artifact. A red gate standing beside a destroyed
  artifact is not a caught mutation. The ledger had the same unguarded shape and
  now has the same protection.
- The battery restores the committed artifacts from git between mutations and
  prints which mutation damaged what, so the post-restore control means
  something. Five of the six damage the committed baseline; that is the point of
  them, and it is now visible in the output rather than accumulating silently.

A battery that leaves a doctored committed baseline behind is the hazard this
candidate exists to remove, arriving in the instrument built to measure it.

## 5. Null controls, proved separately per 0091 §2

```
(a) a real --accept with NO flag
    official baseline  0f505971c835d9cc -> e86cd426357542df   MOVED
    official ledger    f1c85e23b88f8178 -> cd16a2a6c99d58d3   APPENDED
    the product default is untouched by this change

(b) pointed at a temp baseline
    official baseline  0f505971c835d9cc  UNCHANGED
    official ledger    f1c85e23b88f8178  UNCHANGED
    temp               written, e86cd426357542df

(c) the two flags compose independently
    --ledger alone     official baseline unchanged, official ledger unchanged
    --baseline alone   official baseline unchanged, official ledger CHANGED
```

The last row is the sharpest of the three: giving `--baseline` alone still
writes the official ledger. Neither flag silently grants the other, and (c) is
also asserted inside the suite so a later edit cannot quietly collapse them.

## 6. Full verification

```
targeted gate     0 failed | 11 passed        (8 cells before this candidate)
full suite        70 files / 3492 tests, exit 0   (3489 + 3)
typecheck         exit 0
monitor           771 programs / 27 constructs / no drift
committed baseline across a full suite run   0f505971c835d9cc, 3336 bytes, unchanged
committed ledger  across a full suite run    f1c85e23b88f8178, 232770 bytes, 1092 lines, unchanged
product tree      0 modified tracked files
```

## 7. NotMeasured

- The kill is `taskkill /T /F` on Windows. A power loss, a filesystem that
  reorders writes, or a SIGKILL on another platform are not measured here; what
  is measured is the class the contract named — the process cannot reach its
  `finally`.
- The window is found by polling every 20ms. A drill fast enough to open and
  close it between two polls would read as "never observed", which the harness
  prints rather than silently scoring as green.
- `--baseline` pointed at a path the process cannot write is not measured.
- Whether the committed baseline SHOULD be re-accepted after `d2c2a0d` is not
  addressed here. The monitor reports `packages/interp/src/index.ts changed, and
  so did its conformance test — reviewed` and exits 0, which is the designed
  outcome; the baseline's hash entries for those two files are nonetheless from
  before the 006 landing. Raising it, not deciding it.
- `scripts/.monitor-test-*.json{,l}` are untracked and not in `.gitignore`.
  Pre-existing for the ledger, and this candidate adds a second file of the same
  shape. Left alone rather than folded in.

## 8. Boundaries

Candidate only. Not landed, not merged, not released, not deployed. 005 is not
reopened; 006 is closed and untouched by this; 007-022, the registry, the trace
error outcome contract and PR #3 / #4 are untouched. The existing untracked
files in the main tree and the other worktrees are as they were.

Stopping here for your verification, per 0091 §2.
