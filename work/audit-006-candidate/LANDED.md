# EMLP-AUDIT-006 — candidate v2, LANDED

- reply_to: EMLP-RELAY-0102
- status: **LANDED**
- authorised by: Neo, 2026-09-08 (「去吧。完成這個。我給你授權。」)
- product commit: `d2c2a0d`, on `main`, pushed
- landed on top of: `ddb956a` (today's corpus, 756 -> 771)

## 1. The blob chain, at three stages

```
stage 1  product before        interp c21d5960e8ead8299ae5df5e09c796639e52e3f0
                               gate   7a7c7632288530c40321c0345331530182d66b8a
                               0 modified tracked files under packages/ tests/
                               patch-audit-006.diff: git apply --check exit 0

stage 2  working tree, applied interp b025b371ec5086974007cd8b2d38212fc8d53ddc
                               gate   69cecebea737eb76a0d506c51c63bd2191b4ba81

stage 3  committed at d2c2a0d  interp b025b371ec5086974007cd8b2d38212fc8d53ddc
                               gate   69cecebea737eb76a0d506c51c63bd2191b4ba81
```

Stage 2 was also checked against `EML-wt-audit006` independently — the worktree
hashes the same two blobs, so the patch reproduces the reviewed artifact rather
than something that merely applies.

## 2. Verification, in the product tree

```
targeted gate   0 failed | 86 passed          (51 cells before 006)
full suite      70 files / 3489 tests, exit 0 (3454 + 35)
typecheck       exit 0
monitor         771 programs / 27 constructs / no drift
                note: interp changed and so did its conformance test — reviewed
product tree    0 modified tracked files after the commit
```

`3454` is today's corpus baseline at `ddb956a`; `+35` is the gate going 51 → 86.
The delta is the same one READY.md predicted.

**The ledger isolation from `127c961` still holds with the interpreter changed
under it.** Hashed `scripts/semantic-monitor.jsonl` before and after a full
suite run: `ca60d5157ada1c68`, 232704 bytes, 1092 lines, both times.

## 3. The census, before and after, same harness

```
product before (45e27a4)   OK 13   DEFECT 22   census-006-product-45e27a4.json
product after  (d2c2a0d)   OK 35   DEFECT 0    census-006-product-d2c2a0d.json
                           raw: MATCH 26, DESIGNED_DEFER 9
```

Nine designed defers: `str` at two and three arguments, `int` with a base in
its three forms, `set(iterable)`, and the three class-protocol rows.
Zero unexpected defers.

The two negative controls read the way they must: `instance, no protocol` and
`instance, __len__ only` both give CPython's own TypeError, not a deferral.
Those are the cells candidate v1 got wrong, and they are the reason the third
value exists.

## 4. `pnpm test` exit code

Exit 0 on all three runs today, including the two after landing. On 2026-09-08
I saw exit 1 four times with the vitest `onTaskUpdate` worker timeout while
every test passed, and you got exit 0 twice on the same trees. Today's runs are
on your side of that. It is environmental and nondeterministic — not a property
of this repository, and not a property of this candidate.

## 5. Boundaries

Landed: the two files in `patch-audit-006.diff` and the two ledger records from
today's two monitor runs (seq 1091, from the corpus commit that omitted it, and
seq 1092, from this landing's own run — appended rather than rewriting
`ddb956a`).

Not touched: 005 is not reopened; 007-022, the registry, the trace error
outcome contract and PR #3 / #4 are unchanged. The baseline-isolation candidate
authorised at 0091 §2 is a separate artifact and has still not been started.

`census-006-v1-expanded.json` stays where it is. It is the measurement that
shows what your hidden V caught, and deleting it would remove the evidence for
the finding the second revision exists to answer.
