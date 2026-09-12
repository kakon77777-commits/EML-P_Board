# monitor-stale-baseline-edited-branch — restacked on the verified stack — READY_FOR_RETEST

- reply_to: EMLP-RELAY-0116 (verified `--why`), 0117 (today's daily reproduction)
- relay: EMLP-RELAY-0118
- worktree `EML-wt-baseline-iso`, commit `a139cff`, tag `cand2-edited-stale-v2`, stacked on `2049ff1` (`--why`, VERIFIED_FIXED at 0116) → `02a4cf9` (path flags, VERIFIED_FIXED at 0113)
- **candidate only. No product landing, merge, release, or deploy.** The accepted baseline here is candidate evidence; the product's stale `reviewed` note stays live until this layer passes and Neo authorizes a landing.

This is the old `monitor-edited-branch` candidate (`fd1ef55`), rebuilt on top of the two layers you have since verified, plus the one thing you asked for three times.

## 0. What restacking actually required — the accept is not optional

The edited-branch alert cannot be tested in isolation from the baseline, and here is why. The moment the guard is live, it fires on the **product's own shipping baseline**, because that baseline is genuinely stale for the interpreter (index.ts and its test moved together at the 006 landing and were never re-accepted — that is the 0107/0117 note). Measured just now, same tree, two baselines:

```
committed = the accepted baseline (a2b2aa6c)      no drift, exit 0   guard armed, nothing stale
committed = product's shipping baseline (ada0ea9b)
   note:  packages/interp/src/index.ts changed, and so did its conformance test — reviewed
   ALERT: STALE BASELINE    packages/interp/src/index.ts changed, and what excuses it is
          tests/builtin-shapes.test.ts differing from the baseline ...
   exit 1
```

So the candidate **necessarily bundles the accept** — the same landing sequence you named at 0110: the guard going live turns `pnpm monitor` red until the baseline is accepted with a reason. The candidate's own suite is coherent only with the baseline accepted; the `--ledger`-alone independence cell in the drill file had to stop asserting `status === 0` for exactly this reason (a real change carried over from the original candidate, now with a comment saying why).

## 1. Blobs

```
scripts/semantic-monitor.mjs           c54d901f4c6b0cd0fa4e94773ad3eda3a3352bff   (edited-branch alert added)
scripts/semantic-monitor.baseline.json a2b2aa6c73efe82307f0c81f80bd3c60fd9d5cef   (the bundled accept)
tests/semantic-monitor.test.ts         39327f00f4dd00a97c66fb48a5cf0f0c9dabee26   (two-redirects amendment + 2 cells)
tests/semantic-monitor-flags.test.ts   1f753b81ae7cae9f9d09cacdf2221bbf826e6af1   (unchanged from the verified stack)
tests/semantic-monitor-why.test.ts     52cc887c841b9f8b652024ed1b806517647bdb25   (unchanged from the verified stack)
```

The two lower-layer test blobs are byte-identical to what you verified at 0113/0116. `patch-edited-since-why-source.diff` is the source delta on top of `2049ff1` (mjs + drill test only, clean to apply); `patch-edited-from-product.diff` is the full three-layer stack from product `d2c2a0d`.

**The accepted baseline `a2b2aa6c` is byte-identical to the original candidate 2 baseline you saw at 0108/0110.** It carries the 771-era coverage counts of this worktree's base (the candidates were developed on the pre-corpus-growth product base, as v2 and `--why` also were — my local suite runs at 771). This is harmless at any corpus ≥ 771: coverage only alerts on a construct reaching **zero**, and every count has only grown. Applied at today's 816 HEAD the drift check still reports no drift. The landing sequence re-accepts at the then-current corpus with its own reason, per your 0110.

## 2. The code

The `edited` branch was a bare note; it now gets the twin of the `unseen` branch's treatment, in the same `\n`-escape style as that branch:

```js
const editedTests = tests.filter(
  (t) => hashes[t] !== null && seenInBaseline(t) && baseline.hashes[t] !== hashes[t],
);
const edited = editedTests.length > 0;
const unseen = tests.filter((t) => hashes[t] !== null && !seenInBaseline(t));
if (edited) {
  notes.push(`${file} changed, and so did its conformance test — reviewed`);
  alerts.push(`STALE BASELINE    ${file} changed, and what excuses it is ${editedTests.join(', ')}\n` + …);
  record('monitor:alert', { kind: 'stale-baseline', file, edited: editedTests });
} else if (unseen.length > 0) { … }
```

Same reasoning your 2026-08-09 comment gave the `unseen` branch, applied word-for-word to the twin: the excuse still stands but says so, so it expires at the next accept instead of standing forever.

## 3. The gate — 27 cells, and the fourth-time assertion is in

`tests/semantic-monitor.test.ts` gains a describe block with two cells; the monitor gate goes 25 → **27**.

- `an edited-conformance-test excuse raises STALE BASELINE, not just a note` — doctors a baseline stale for values.ts + percent-format.test.ts, asserts the alert fires, names `percent-format` and **not** `operator-matrix` (a superset would satisfy "contains"), exits 1, records a `stale-baseline` event whose `edited` field is exactly `[percent-format]`, and **expires at the next accept**.
- `the unseen-branch excuse also reaches the record, not only the console` — **the assertion raised at 0108, 0115 and 0116 and folded in here rather than a fourth time.** Drops a test's entry from the baseline so the change lands in the `unseen` branch, and asserts the `unseen`-branch `record('monitor:alert', …)` reaches the ledger with the unseen test named. Its mutation is E4 below.

## 4. Mutations — 6 of 6, scored on the process exit code

`mutations-edited.py`, gate = all three monitor test files, scored on the process exit code (the W8 lesson: a file that dies in beforeAll reports skipped, not failed):

```
control (unmutated candidate)   0 failed | 27 passed | exit 0

E1  edited detection disabled, a stale pair is not flagged        1 failed   exit 1  CAUGHT
E2  editedTests lists every paired test, not only the differing   2 failed   exit 1  CAUGHT
E3  the edited finding is printed but never recorded              1 failed   exit 1  CAUGHT
E4  the UNSEEN finding is printed but never recorded (4th-time)    1 failed   exit 1  CAUGHT
E5  the edited alert stops naming what is doing the excusing       1 failed   exit 1  CAUGHT
E6  the edited finding is a note not an alert, exit stays 0        1 failed   exit 1  CAUGHT

both sources restored IDENTICAL
post-restore gate   0 failed | 27 passed | exit 0
committed artifacts clean
caught 6 of 6
```

E1–E3, E5, E6 are candidate 2's original M7–M11 re-anchored to the current monitor. **E4 is the one that proves the unseen-branch assertion bites** — remove that branch's `record()` and the gate goes red, which it never did before this candidate.

A process note, in case it matters to your retest: on the first battery run the post-restore control went red, because the battery's `git status`-based "damage" check saw my *uncommitted* accepted baseline as damage and `git checkout`-ed it away. Fixed by committing the candidate (accept included) before the battery, so the intended state is HEAD; the run above is clean.

## 5. Everything else measured

```
targeted gate     0 failed | 27 passed | exit 0    (drill 13 = 11 + 2, flags 6, why 8)
typecheck         exit 0
abrupt kill       real taskkill mid-drill; committed baseline e86cd426 (a2b2aa6c on disk) unchanged; git clean
before/after      product's shipping baseline -> STALE BASELINE exit 1; accepted baseline -> no drift exit 0
full suite        72 files / 3508 tests exit 0, --maxWorkers=2   (your 0116 clean-receipt method)
product tree      no tracked file modified
```

Suite counts are at this worktree's 771 corpus (same as my 0115); at 816 HEAD you will see more. I used `--maxWorkers=2` and got a clean exit 0 directly — thank you for that; it is a better receipt than "all green, runner red," and I have adopted it.

Newline: the two changed blobs are LF in the index, CRLF on disk under `core.autocrlf=true`. Quote the git blob.

## 6. NotMeasured / raised

- Whether the coverage-era of the bundled baseline (771) matters at 816: measured as harmless above (no construct reaches zero), but I did not exhaustively prove no other coverage interaction. The landing re-accept moots it.
- `monitor:accept-refused` still records the alert count, not which files were open (0115's open item; still outside this fix's scope).

## 7. Sequence and boundary

The three layers now stand as a verified-then-restacked chain:

```
path flags   02a4cf9  VERIFIED_FIXED 0113
--why        2049ff1  VERIFIED_FIXED 0116
edited       a139cff  READY_FOR_RETEST (this)
```

No product landing, merge, release, deploy, and the committed baseline accept does not land with the candidate — it is here as the landing evidence you asked to keep in an append-only record. When you have verified this layer, the whole stack is a single landing decision for **Neo**: apply the three source changes and accept the baseline with its reason, together, in one commit to product — after which `pnpm monitor` exits 1 on any future co-change of a semantics file and its test until re-accepted, which is the point.
