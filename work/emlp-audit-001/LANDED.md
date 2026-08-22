# Landed — EMLP-AUDIT-001 and 002

Product commit `7bc3100` in `efficientnewlanguage`, 2026-08-22.
Rulings: `EMLP-RELAY-0033` (001), `EMLP-RELAY-0034` (002). Landing: `EMLP-RELAY-0036`.

## Blob equality, checked in the index

`git add` runs autocrlf on this machine and warned on all three files, so the
worktree hash is not the check. `git ls-files -s` after staging:

```
b1ae54d7d93c1c3b77a5f8a33297d197aff06cbc packages/ai-converter/src/validator.ts
bc4e0b116a6044c1a7d17e02c6cf637f7c291877 tests/verification-cen-heng-0028-0029.test.ts
dbdd366af4fcabfc120a0d1e8ca5c896d7fef688 tests/verification-cen-heng-0033-0034.test.ts
```

All three equal the blobs 岑衡 ruled on and the two V blobs in PR #1, so the
re-regression clause in `EMLP-RELAY-0034` did not trigger. Her V files landed
verbatim; not a line was changed, including the now-redundant "copy this file
to the language repo" instruction in the header — editing it would have broken
blob equality with the PR.

## Independent re-run of her V

- product HEAD without the patch (blob `4d0b74be`): **4 red / 1 green**
- with the patch: **32/32 green**
- full suite: **64 files / 2557 tests**, matching her count

The one green at baseline is her ordering NULL control. It is *supposed* to be
green there — baseline has no fail-closed return to swallow it. It only starts
discriminating once the patch is in, which is why she wrote it.

## Drills, re-run against the landed product

Blob-identical to the candidate, so this could only confirm — but "the blob is
the same so it must behave the same" and "I ran it" are different claims.
Union of all 32 audit tests:

```
DRILL A — restore the numericVars.length === freeVars.length gate
  × Cen Heng V — 001 round 2 > certifies a different genuinely equivalent numeric/boolean pair
  × 001 mixed bindings > still CERTIFIES a genuinely equivalent mixed numeric/string pair
  × 001 mixed bindings > reports that the numeric variables were covered despite the string one
  Tests  3 failed | 29 passed (32)

DRILL B — move the fail-closed return after the discrimination check
  × Cen Heng V — 001 round 2 > fails closed even when LLM-only string inputs look discriminating
  × 001 mixed bindings > fails closed when EVERY free variable is non-numeric
  Tests  2 failed | 30 passed (32)

DRILL C — a one-sided failure is not a divergence
  × Cen Heng V — 002 rebinding > keeps a one-sided clean exit visible before all-string fail-closed
  × Cen Heng V — 002 > treats a one-sided timeout as a behavioral divergence
  × 002 > certifies a candidate that raises where the original does not
  × 002 acceptance > names the failing side in the detail
  × 002 acceptance > catches the reverse: the candidate swallows an error the original raises
  Tests  5 failed | 27 passed (32)
```

Red counts 3 / 2 / 5 match hers exactly. Blob restored to `b1ae54d7` after each.

**Mechanism counts.** A hits only 001's coverage tests, B only the fail-closed
tests, C only 002's. Cross-contamination zero. A and B are both part of the 001
patch but strike disjoint test sets, so the two mechanisms are independently
aimed rather than propping each other up.

## What drill A shows from the other side

All three of drill A's red are **acceptance** tests. Not one rejection test
goes red under it, because with the hole restored those cases fall into the
fail-closed branch, which also returns `false`.

That is the gap 岑衡 opened `EMLP-RELAY-0033` by conceding, measured from the
opposite direction: this patch's rejection surface has no discriminating power
at all. Only the acceptance surface separates "coverage genuinely extends to
mixed bindings" from "anything non-numeric is refused outright". Her second
round-2 V lands exactly in that cell and is one of drill A's three.
