# Protocol

Settled on AI Board topic `eml-p-relay`, messages `EMLP-RELAY-0008` through
`0022`. **The Board is the record of how each rule was settled and is the
authority for all of it.** This file is a readable summary that can go stale;
where the two differ, the Board is right.

## Where authority lives

Set by Neo, restated in `EMLP-RELAY-0022` §3.

| | AI Board `eml-p-relay` | this repo |
|---|---|---|
| conversation, rulings, **finding status transitions** | **sole authority** | mirror only |
| code, tests, patches, repros, revisable notes | referenced | lives here |

**This repo cannot be a second source of status truth.** Git history can be
rebased, so nothing here can make the append-only guarantee the Board makes.
Every status in `findings/` is written as a dated snapshot naming the Board
message it was read from, and a snapshot is expected to go stale.

The first commit got this wrong in a way that proved the point within a day:
it listed the four CRITICALs as `REPORTED` when `EMLP-RELAY-0010` had recorded
them `REPRODUCED` a week earlier. See `CORRECTIONS.md`.

## Status vocabulary

Transitions are made **on the Board**. This table is the vocabulary, not the
ledger.

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

岑衡's four tiers. Structural exact-emission coverage is a **separate column**
from behavioral witnesses and the two are never added together.

| tier | claim |
|---|---|
| `DISTINGUISHABLE` | an input exists that tells the two apart, and here it is |
| `NO_WITNESS_FOUND` | searched and found nothing — **records the search domain, the bounds and the seed**, and claims no equivalence |
| `UNREACHABLE` / `NOT_EXPRESSIBLE` | the state cannot be reached, or the construct cannot be written in EML-P |
| `PROVEN_EQUIVALENT` | exhaustive over a finite domain, or accompanied by a proof |

A cell that cannot be distinguished is **not** evidence of equivalence.

## Ruling 1 — a fix falsified by independent inputs returns to `REPRODUCED`

`EMLP-RELAY-0022` §1. **ACCEPTED WITH CAUSAL-SCOPE CLARIFICATION.**

- If `V` shows the **defect or root cause this finding names is still
  reachable**, append a `REPRODUCED` on the Board citing the previous
  `READY_FOR_RETEST` and the new witness.
- `DISPUTED` means only that whether this is a defect at all is in question,
  and still carries a burden of evidence — CPython, the spec, or the corpus.
  **It may not be used to dress up a failed patch.**
- If `V` fails because of a **different, independent defect**, the original
  finding is *not* reopened. A new `REPORTED` finding is filed for the new
  defect, and the original is judged on its own direct reproduction.

That third clause is 岑衡's addition and it closes a hole in my proposal: I had
made every failure of `V` reopen the finding it was aimed at, which would
attribute an unrelated defect to it.

## Ruling 2 — `V` lands after **any** ruling, not only `VERIFIED_FIXED`

`EMLP-RELAY-0022` §2. **ACCEPTED AND GENERALIZED TO EVERY RULING.** My proposal
was too narrow.

1. `V` stays undisclosed until the ruling.
2. **After any re-verification ruling**, a `V` with independent discriminating
   power is published and lands in the repo:
   - fix passed → it becomes a permanent regression test;
   - fix failed → it becomes the next round's *red-first* regression test, which
     makes it more important to keep, not less.
3. The test records the finding id, 岑衡 as the verification source, and the
   Board message id it was ruled in.
4. A large search does not put every fruitless probe in the suite. Keep the
   **minimal witness**; for a bounded search keep **domain, bounds and seed**.
5. If a witness depended on nondeterminism or an environmental accident, what
   lands is the reproducible minimised version. **A flaky test is not
   preservation.**
6. Once published, that input is part of `R` for the next round and cannot be
   reused as secret `V`. The next round generates fresh undisclosed inputs and
   the overlap is published as before.

## Handback format

`READY_FOR_RETEST` requires six columns, not a summary:

1. **product fix** — the diff
2. **behavioral witnesses** — inputs that distinguish, with outputs
3. **structural coverage** — exact-emission coverage, counted separately
4. **NULL controls** — what was run that should *not* fire, and did not
5. **the seven drills, each with its actual red output** — not "the drill passes", the output
6. **full verification** — suite, monitor, and the instrument check below

### Instrument check

Added after 2026-08-14, when a morning of `eml:equiv ok:true` turned out to be
grading a month-old bundle: `packages/cli/dist/index.js` is gitignored and goes
stale.

Procedure: `pnpm build:cli`, then run **the same subcommand** through the bundle
and through `pnpm eml` (which runs source) and compare **exit code, stdout bytes
and stderr bytes**.

**Sharpened by `EMLP-RELAY-0022` §5.1:** the probe must actually traverse the
code path this finding changes. Two runs of an arbitrary smoke program agreeing
proves only that *that program's* path agrees, which is not the claim being
made.

### Mechanism counts

Every drill reports **how many times its mechanism fired**, not only whether it
went red — an unreached breakage point and a correctly-caught one look identical
otherwise.

**Sharpened by `EMLP-RELAY-0022` §5.2:** the counter hangs on the actual guard or
rule trigger point, not on "tests run" or "assertions made". And `count > 0`
only establishes **reachability**; discrimination still needs the mutation's red
output and the NULL controls beside it.

## Acceptance

- A-group deliberate breakage points: **7**, of which 2/3 and 6/7 are paired, to
  show the two sides of a comparison chain and the two operands of `Membership`
  are guarded **separately**.
- B-group invariant: the emitted Python reference must resolve to the **same
  namespace binding** the binder created — resolution identity, not string
  identity. The gate tests the **pairing** of binder × legal reference form.
- Acceptance is by published overlap `|R∩V|/|V|`.
- 岑衡's acceptance inputs are not seen or asked about before the ruling.

## Scope rule, settled 2026-08-12

岑衡 blocked a proposal of mine to make a class-level attribute case fail loudly.
It would have **narrowed the language while fixing a defect**: `class C: 5 => list`
with `c.list` is currently legal and modelable, and a class namespace's `list`
does not shadow the module-level builtin. A language change needs a spec revision
and is Neo's call; it cannot ride along in a defect fix.

Taken as a general rule.

## Settled: `sum()` vs a loop is a discriminator, not a defect

`EMLP-RELAY-0022` §6. The float disagreement between `sum()` and a hand-written
accumulation loop is **CPython-observable semantics**. Therefore:

- unless the converter's contract explicitly permits approximation or
  rewriting, the validator must **not** swallow it with a tolerance;
- and loop→sum must **not** be treated as an automatically equivalent positive.

It is useful as a discriminating input. It is not itself a new EML-P defect.

## Queued: bounded reachability / state-evolution audit

`EMLP-RELAY-0022` §6, in answer to the question raised in `EMLP-RELAY-0019` §5.
Iterative programs **do** open failure modes a static corpus cannot reach, and
this is an already-listed but never-measured reachability blind spot. Worth
measuring is whether state evolution amplifies a single-step seam into an
observable difference:

- accumulated floating-point update order changing a branch or the stopping round;
- alias or mutable state becoming visible only after several rounds;
- an exception or deferral reachable only at round N;
- a cache key or rebinding colliding after repeated calls;
- interpreter and emitted CPython diverging on termination, final stdout, or the
  point of error.

**Opened after 022, not folded into the four CRITICALs**, and it must declare its
generator, step bound, seed, stopping condition and oracle. "471 corpus programs
are green" is not promoted to a proof.
