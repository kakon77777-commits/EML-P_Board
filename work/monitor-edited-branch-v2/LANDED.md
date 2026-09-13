# LANDED — the monitor drift-guard stack is in product

- relay: EMLP-RELAY-0121
- authorized by: Neo, 2026-09-13 ("備妥並直接落地")
- product commit: `97023ec` on main, pushed
- auditor verdicts that gated this: 0113 (path flags), 0116 (--why), 0119 (edited-branch), all VERIFIED_FIXED candidate-only

## What landed

Three layers, in one commit, applied to product HEAD `00d0abb` (831 corpus):

```
scripts/semantic-monitor.mjs           c54d901f…   (auditor-verified blob, 0119)
tests/semantic-monitor.test.ts         39327f00…   (auditor-verified blob)
tests/semantic-monitor-flags.test.ts   1f753b81…   (auditor-verified blob)
tests/semantic-monitor-why.test.ts     52cc887c…   (auditor-verified blob)
scripts/semantic-monitor.baseline.json 38ca12b3…   (regenerated at 831 HEAD — NOT the
                                                     candidate 771-era a2b2aa6c)
```

The four source blobs are byte-identical to what the auditor verified at 0119.
The baseline was **not** taken from the candidate; it was regenerated at the
landing HEAD via the official `--accept --why`, so it carries 831-era coverage
and the accept reason is in the committed ledger (seq 1099).

## Why the candidate commit `a139cff` was not landed directly

Per the auditor's 0119 landing boundary: `a139cff` bundles the 771-program
baseline and its accept has no `monitor:accept` reason in the official ledger.
Landing regenerated the current baseline and recorded the accept, keeping the
product action separate from the candidate verdict.

## Post-landing verification (0119 §4)

```
corpus                    831 programs
monitor                   no drift, exit 0
0107 stale-reviewed note  gone from product
targeted gate             27/27 exit 0 (edited + unseen witnesses present)
official ledger           seq 1099 monitor:accept with reason, committed
product tree              clean
typecheck                 exit 0
full suite                72 files / 3688 tests exit 0 (--maxWorkers=2)
```

## Consequence, stated before landing

From here, `pnpm monitor` exits 1 after any landing that co-moves a
semantics-bearing file and its conformance test, until the baseline is
re-accepted with a reason. That is the guard working, not a regression.

The candidate worktree tags `cand1-baseline-iso-v2`, `cand-why-v1`,
`cand2-edited-stale-v2` are retained as history.
