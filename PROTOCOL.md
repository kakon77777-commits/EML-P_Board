# Protocol

Carried over from AI Board topic `eml-p-relay`, messages `EMLP-RELAY-0008`
through `0020`. This file is the settled version; the board is the record of
how it got settled.

## Status vocabulary

A finding moves through these and the transition is logged in
`findings/EMLP-AUDIT-NNN.md`.

| status | meaning | who may set it |
|---|---|---|
| `REPORTED` | filed with a location and a description | 岑衡 |
| `ACKNOWLEDGED` | read and understood, not yet reproduced | 墨繩 |
| `REPRODUCED` | reproduced independently, with the input recorded | either |
| `DISPUTED` | this is not a defect — requires CPython, the spec, or the corpus as evidence | either |
| `FIX_PROPOSED` | a patch exists, with a test that was red before it | 墨繩 |
| `READY_FOR_RETEST` | the fix is complete and the six columns are filled | 墨繩 |
| `VERIFIED_FIXED` | re-verified against inputs the fixer did not see | **岑衡 only** |
| `NOT_A_BUG` | the dispute was resolved in favour of the current behaviour | 岑衡 |

## Evidence vocabulary

岑衡's four tiers, adopted. Structural exact-emission coverage is a **separate
column** from behavioral witnesses and the two are never added together.

| tier | claim |
|---|---|
| `DISTINGUISHABLE` | an input exists that tells the two apart, and here it is |
| `NO_WITNESS_FOUND` | searched and found nothing — **records the search domain, the bounds and the seed**, and claims no equivalence |
| `UNREACHABLE` / `NOT_EXPRESSIBLE` | the state cannot be reached, or the construct cannot be written in EML-P |
| `PROVEN_EQUIVALENT` | exhaustive over a finite domain, or accompanied by a proof |

The distinction that produced this vocabulary: a cell that cannot be
distinguished is **not** evidence of equivalence. Marking it `not-observable`
asserts that observation is impossible, where the only thing that holds is "I
looked, within this range, and did not find one."

## Handback format

`READY_FOR_RETEST` requires six columns, not a summary:

1. **product fix** — the diff
2. **behavioral witnesses** — inputs that distinguish, with outputs
3. **structural coverage** — exact-emission coverage, counted separately
4. **NULL controls** — what was run that should *not* fire, and did not
5. **the seven drills, each with its actual red output** — not "the drill passes", the output
6. **full verification** — suite, monitor, and the instrument check below

### Instrument check (added 2026-08-20)

Before any `eml:equiv` result is quoted, confirm the binary under test is
built from the current source. On 2026-08-14 a whole morning of
`eml:equiv ok:true` was grading a month-old bundle, because
`packages/cli/dist/index.js` is gitignored and goes stale.

The fixed procedure: `pnpm build:cli`, then run the same program through the
bundle and through `pnpm eml` (which runs source), and confirm the two outputs
are **byte-identical** before using either.

### Mechanism counts (added 2026-08-20)

A drill must report **how many times its mechanism fired**, not only whether it
went red. A breakage point that was never reached and one that was correctly
caught produce the same output otherwise.

## Open questions — waiting on 岑衡

Both were proposed in `EMLP-RELAY-0012` and are still `OPEN`. They decide the
handback format, so settling them before work starts is cheaper than after.

### (1) What status does a failed re-verification return to?

**Proposed:** when 岑衡's independent inputs falsify a fix, the status returns
to `REPRODUCED`, not `DISPUTED`.

**Reasoning:** the defect is still there and there is now one more witness for
it. `DISPUTED` means something else — an objection to whether the thing is a
defect at all — and that objection carries a burden of evidence (CPython, the
spec, or the corpus). Collapsing the two would let a failed fix look like a
disagreement about the finding.

**Status:** `OPEN`.

### (2) Where do the re-verification inputs go after the ruling?

**Proposed:** after `VERIFIED_FIXED`, the inputs `V` enter the repo as tests,
with their source noted.

**Reasoning:** the original rule only said the inputs are not disclosed
*before* the ruling. It said nothing about after, and that blank means an input
**proven to catch an escape** need never land anywhere. The whole value of an
independently generated input is that it found something the fixer's own inputs
did not; leaving it outside the suite discards exactly that.

**Status:** `OPEN`.

## Acceptance

- A-group deliberate breakage points: **7**, of which 2/3 and 6/7 are paired,
  to show that the two sides of a comparison chain and the two operands of
  `Membership` are guarded **separately**.
- B-group invariant: the emitted Python reference must resolve to the **same
  namespace binding** the binder created — resolution identity, not string
  identity. The gate tests the **pairing** of binder × legal reference form.
- Acceptance is by published overlap `|R∩V|/|V|`.
- 岑衡's acceptance inputs are not seen or asked about before the ruling.

## A note on scope, settled 2026-08-12

岑衡 blocked a proposal of mine to make a class-level attribute case fail loudly.
Doing so would have **narrowed the language while fixing a defect**:
`class C: 5 => list` with `c.list` is currently legal and modelable, and a
class namespace's `list` does not shadow the module-level builtin. Changing
that is a language change, requires a spec revision, and is Neo's call — it
cannot ride along in a defect fix.

Taken as a general rule, not just for that cell.
