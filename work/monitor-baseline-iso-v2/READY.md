# monitor-baseline-isolation v2 — READY_FOR_RETEST

- reply_to: EMLP-RELAY-0108 §2–§3 (RETEST_FAILED), EMLP-RELAY-0110, EMLP-RELAY-0111
- relay: EMLP-RELAY-0112
- worktree: `EML-wt-baseline-iso`, commit `02a4cf9`, tag `cand1-baseline-iso-v2`
- **candidate only. Not landed, not merged, not released, not deployed.**
- baseline NOT accepted. The stale `reviewed` note is still live on the product, deliberately, per 0111.

## 0. Your counterexamples, reproduced here first

Before touching anything I ran your two probes plus a third, in a fresh detached
worktree at the exact candidate-1 blobs, with exit codes read from `$?` and never
through a pipe. `probe-before-candidate1.log`:

```
--ledger <drill> --accept --why probe --baseline
    exit 0   baseline ada0ea9b/3336 -> a2b2aa6c/3260   git status M
--ledger
    exit 0   ledger 232770 -> 232946 bytes             git status M
--baseline --ledger <drill>
    exit 0   BASELINE resolved to the literal string "--ledger", so the run
             found no baseline, compared against nothing, and printed
             "no baseline yet — run with --accept to record one"
no flags (null control)
    exit 0   committed artifacts used, as they should be
```

You are right on both, and the third is worse than either: it writes nothing, so
no write-watching gate can see it, and it silently turns the drift check off.

**One thing your 0108 called `沿用` and I can now put a number on: probe B
reproduces on the SHIPPED PRODUCT monitor.** Same probe, `git checkout d2c2a0d --
scripts/semantic-monitor.mjs`, blob `999b384bdaf098cb32e1cfe4ebbe029bc4d624b7`:

```
--ledger      exit 0   ledger 232770 -> 232946   git status M
```

So the fail-open shape is live in the product today. Candidate 1 did not invent
it; it copied the shape onto `--baseline`, where the flag governs `--accept` and
therefore writes an expectation rather than a log line. v2 fixes both, which
means this layer closes a product defect as well as a candidate one.

One coincidence worth naming rather than leaving to be found: the baseline that
probe A wrote by accident is git blob `a2b2aa6c73efe82307f0c81f80bd3c60fd9d5cef`
— **byte-identical to the accepted baseline I shipped in candidate 2's
`patch-2-full.diff`**. It supports what I claimed there (the accept is
tree-determined), and it also says the artifact alone cannot distinguish a
considered accept from a mistyped command. Only the ledger line can.

## 1. What changed

Two files. `tests/semantic-monitor.test.ts` is **untouched** — same blob you
already read.

```
scripts/semantic-monitor.mjs         a193c7e8 -> 8652e046   (modified)
tests/semantic-monitor.test.ts       fe2094d9 -> fe2094d9   (UNCHANGED)
tests/semantic-monitor-flags.test.ts          -> 1f753b81   (new)
```

The two inline expressions are gone; both flags now go through one function:

```js
function pathFlag(flag, committedDefault) {
  const at = [];
  for (let i = 2; i < process.argv.length; i++) if (process.argv[i] === flag) at.push(i);
  if (at.length === 0) return committedDefault;
  if (at.length > 1) refuse(`${flag} was given ${at.length} times; which path is meant is ambiguous`);
  const value = process.argv[at[0] + 1];
  if (value === undefined) refuse(`${flag} needs a path, and is the last argument`);
  if (value.trim() === '') refuse(`${flag} was given an empty path`);
  if (value.startsWith('--')) refuse(`${flag} was followed by ${value}, which is another flag rather than a path`);
  return value;
}
```

Against your §3 conditions:

| your condition | v2 |
|---|---|
| flag absent → committed default | `at.length === 0` returns it; null control below |
| next argv must exist | `value === undefined` → refuse |
| …be non-empty | `value.trim() === ''` → refuse |
| …not be another `--` flag | `value.startsWith('--')` → refuse |
| duplicate ambiguity | `at.length > 1` → refuse |
| fail loud before any I/O or record | `pathFlag` runs above `let seq = nextSeq()`, which is the first thing that opens the ledger. Nothing is read and nothing is written. |
| no-flag default and legal redirect stay positive controls | null control in the log below; legal-form cell in the gate |

Two decisions I made rather than inherited, both stated so you can overrule them:

- **Exit 2, not 1.** Exit 1 already means "the monitor checked and the tree needs
  looking at". Exit 2 means "the monitor did not check". The daily flow reads
  this code; a caller that cannot tell a typo from a regression will either chase
  drift that does not exist or learn to ignore the report that matters.
- **A refusal is not recorded.** Recording needs a resolved ledger path, which is
  the thing just refused, and appending to the committed one would be exactly the
  write the flag was asking to send elsewhere.

## 2. The same probes, after

`probe-after-v2.log`, same script, same worktree shape:

```
--ledger <drill> --accept --why probe --baseline   exit 2   both artifacts unmoved
--ledger                                            exit 2   both artifacts unmoved
--baseline --ledger <drill>                         exit 2   both artifacts unmoved,
                                                             no file named ./--ledger,
                                                             no drill ledger created
no flags (NULL CONTROL)                             exit 0   committed artifacts used,
                                                             ledger 232770 -> 232946
```

The null control is the one that matters for over-strictness: v2 has not turned
the ordinary command into a refusal.

**A defect in my own instrument, fixed before shipping it.** The first version of
`probe-0108-missing-path.sh` checked for a file named `--ledger` with
`test -e -- '--ledger'`, where bash reads the `--` as a binary operator: a broken
check that prints a confident answer. Same class as the pipeline exit code you
caught in `probe-edited-branch.sh`. Both logs above were re-run with the fixed
script, so the shipped logs match the shipped script.

## 3. The gate

`tests/semantic-monitor-flags.test.ts`, six cells, one spawn each. Your six
required cells, mapped:

| you asked for | cell |
|---|---|
| 1. `--baseline` at argv end: non-zero, both artifacts unchanged | `--baseline as the last argument is refused, writes nothing, and records nothing` — also asserts exit 2 ≠ 1 and that no ledger, drill or committed, gained a line |
| 2. `--baseline --ledger temp` must not treat `--ledger` as a filename | `a path flag does not swallow the next flag as its path` — also asserts the comparison never ran |
| 3. `--ledger` at argv end: non-zero, ledger unchanged | `--ledger as the last argument is refused` |
| 4. empty string and duplicate, explicit and executable | `an empty path is refused rather than resolved`, `a flag given twice is refused rather than resolved to one of them` |
| 5. no-flag default and legal redirect, positive controls | `the legal forms still work — the positive control` in the gate; the **no-flag default cannot be a suite cell** — running it once would be the very write the isolation gate exists to catch — so it is the null control in §2, measured on the real command rather than assumed |
| 6. a reverse mutation per cell, and the same abrupt kill | §4 and §5 |

Gate size: product 8 → candidate 1's 11 → **17** (11 + 6).

Why a separate file rather than a block in `tests/semantic-monitor.test.ts`: it is
a different concern (what the CLI does with its arguments, not whether the drift
drill writes the record), and it leaves your already-read test file at the same
blob. See §6 for the thing that is NOT the reason, though I believed it for an
hour.

## 4. Mutations — 15 of 15, first run

`mutations.log`, `mutations-baseline-iso-v2.py`. M1–M6 are candidate 1's,
re-anchored: M3, M4 and M6 needed new anchors because the expressions they used
to mutate no longer exist. **M7–M11 are deliberately absent — they belong to
candidate 2, which restacks on this layer afterwards.**

```
control (unmutated candidate)   0 failed | 17 passed

M1  runDrill stops redirecting the baseline                       2 failed  CAUGHT
M2  the drill baseline IS the committed baseline                  2 failed  CAUGHT
M3  --baseline is validated and then ignored                      3 failed  CAUGHT
M4  --ledger silently implies --baseline                          2 failed  CAUGHT
M5  the drill doctors the committed baseline directly             2 failed  CAUGHT
M6  --accept writes the committed baseline whatever --baseline    3 failed  CAUGHT
P1  a flag with no path falls back to the committed artifact      8 failed  CAUGHT
P2  the next-flag guard is dropped                                1 failed  CAUGHT
P3  an empty path falls back to the committed artifact            4 failed  CAUGHT
P4  a flag given twice resolves to the first                      1 failed  CAUGHT
P5  a refusal exits 0                                             5 failed  CAUGHT
P6  a refusal exits 1, indistinguishable from drift               5 failed  CAUGHT
P7  a refusal records itself, into the ledger it just refused     9 failed  CAUGHT
P8  the parser refuses well-formed paths too (over-strict)        7 failed  CAUGHT
P9  the flags file's disposable ledger IS the committed ledger    2 failed  CAUGHT

all three sources restored IDENTICAL
post-restore gate     0 failed | 17 passed
committed artifacts   clean
caught 15 of 15
```

P1, P3, P7 and P9 also damaged a committed artifact while red; the battery
restores them and says so per row, which is the fix from the M2 incident — a red
gate beside a destroyed artifact is not a caught mutation.

The battery runs BOTH gate files. A battery pointed only at the old one would
have reported P1–P8 as NOT CAUGHT and been right for the wrong reason.

## 5. The same abrupt kill, re-run

`kill-v2.log` — same `abrupt-kill.py`, real `taskkill` of the vitest process tree
inside the accept drill:

```
KILLED INSIDE THE DRILL : True
committed baseline before: 0f505971c835d9cc  3336 bytes  doctored=False
committed baseline after : 0f505971c835d9cc  3336 bytes  doctored=False
  unchanged  : True
  git status : (clean)
scripts/ tracked state: clean
```

## 6. `pnpm test` exits 1 on this machine, and it is not this candidate — I said it was

This is the part I got wrong and am correcting rather than quietly dropping.

The suite intermittently ends `71 passed | 3498 passed` with
`[vitest-worker]: Timeout calling "onTaskUpdate"` and **exit 1**: every test
green, the run red. It is birpc's 60-second default firing while the machine is
saturated — seventy-odd files spawning python and node at roughly sixfold
parallelism. Same class as the note already in `vitest.config.ts`, which raised
`testTimeout` for exactly this reason: a fixed bound that is really a statement
about how busy the machine is.

I first measured candidate 1 at exit 0 (once) and v2 at exit 1 (three times),
read it as caused by my new cells, and acted on that reading: I rewrote the
spawns as async (no effect), split them into their own file (no effect), and
trimmed nine spawns to six (exit 0 twice, then 1). Only then did I take three
more samples of the **control**:

```
candidate 1, none of this candidate present   exit 0 (early), then 1, 1, 1
v2, nine spawns                               1, 1, 1
v2, six spawns                                0, 0, 1
v2 final                                      1, 1
```

Three consecutive exit-1 runs of candidate 1 remove the split I thought I saw.
The flake is pre-existing and load-dependent. **What I can still say from
measurement is the cost in spawns and seconds, not the exit code**: these cells
add six monitor spawns, five of which exit before the corpus is scanned.

The file split and the trim survive on their own merits and I have kept them, but
neither is a fix for this and the comment in the test file now says so. If you
want the three trimmed spawns back — a whitespace-only path, a separate
no-record cell, and the write side of the legal `--baseline` — say so and they go
back; every assertion they carried is still made, folded into other cells.

For your retest: `vitest run tests/semantic-monitor.test.ts
tests/semantic-monitor-flags.test.ts` is the targeted gate and exits 0 reliably
here (17 passed). Whole-suite exit code on a loaded machine is not a
discriminative instrument for this candidate in either direction.

## 7. Everything else measured

```
targeted gate     0 failed | 17 passed        (product 8, candidate 1's 11)
full suite        71 files / 3498 tests all passed; exit code per §6
typecheck         exit 0
abrupt kill       real kill, committed baseline unchanged, clean
probes            three refusals exit 2, null control exit 0
product tree      no tracked file modified
baseline/ledger   committed artifacts clean after every run above
```

Newline, stated with the hashes because this relay has now had three of these:
all three blobs are **LF in the index**, CRLF on disk under `core.autocrlf=true`.
The battery's sha256 of the flags file differs between the two (`6462cdb5…` LF vs
`d9b40856…` CRLF) and the git blob does not. The blobs quoted here are the
authority; the final battery, kill and probe runs were all made against the CRLF
bytes a fresh checkout produces.

## 8. NotMeasured, and raised not fixed

- **`--why` has a cousin of this bug and I did not fix it.** `--accept --why
  --baseline tmp` records the literal reason `"--baseline"`. It is not a
  fail-open to a committed artifact — `--why` names a reason, not a path, and an
  empty one is already refused whenever alerts are open — so it is outside the
  narrow fix you asked for. Raising it rather than folding it in.
- Whether any OTHER flag has the same shape. `--accept` is a boolean and takes no
  value; those two are the only value-taking flags. I read the argv handling and
  found no third, but I did not go looking beyond this file.
- Whether the strict parser changes anything for a caller that passes a path
  which exists but is unwritable. That was NotMeasured at 0105 and still is.
- The `unseen` branch's own `record('monitor:alert', …)` still has no assertion.
  Raised at 0108/0109, still not fixed, still not mine to fold in here.

## 9. Boundary

Candidate only. No product landing, merge, release or deploy. The baseline is not
accepted and the stale `reviewed` note is left live, per your 0111. Candidate 2
(`monitor-stale-baseline-edited-branch`) is untouched and still
`BLOCKED_ON_LOWER_LAYER`; its commit is preserved at tag `cand2-edited-stale-v1`
(`fd1ef55`) and it restacks on `02a4cf9` once you have closed this layer. 005 is
not reopened; 006 is closed; 007–022, the registry, the trace error outcome
contract and PR #3/#4 are untouched.
