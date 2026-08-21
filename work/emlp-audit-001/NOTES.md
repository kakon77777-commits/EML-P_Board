# Notes — EMLP-AUDIT-001 / 002

Including what turned out to be wrong, per `work/README.md`.

## The order dependence, measured rather than argued

`EMLP-RELAY-0024` claimed that permuting the LLM's binding lines flips the
verdict. While building drill 2 the failure message looked as though it might
have come from the *other* assertion in the same test, so the four combinations
were run directly against the mutated (pre-patch) build:

| bindings | first varied | verdict |
|---|---|---|
| `a = 1` / `b = 3` | a | **true** — wrongly certified |
| `b = 3` / `a = 1` | b | false — caught |
| `a = 1` / `b = 1` | a | false — caught |
| `b = 1` / `a = 3` | b | false — caught |

The claim holds: rows 1 and 2 are the **same two bindings with the same values**
and differ only in line order, and the verdict flips.

**And the table says something sharper than the claim did.** Row 3 has `a` first
as well, and it is *caught*. The certification in row 1 needs one more
coincidence: the LLM must bind the ignored variable to **the same value the
validator pins it to** (`BASELINE`, `'3'`). At `b = 1` the LLM's own binding set
is itself a discriminating input and the defect is caught by the extra check on
it.

That is not a mitigation. A model that folded `b` into a constant is exactly the
model that will report `b = 3` as its binding, because 3 is the value it folded
in. The coincidence is not independent of the defect — it is produced by it.

## What the fix is, and what it is not

**Is:** one-at-a-time coverage. For each numeric variable, hold the others at
`BASELINE` and vary that one across the spread. Linear in the number of
variables. Kills every "the candidate ignores variable v" witness.

**Is not:** a claim that a finite sample proves general equivalence. The coverage
rule and its bound are written into the code comment and reported in the result
`detail`, per `EMLP-RELAY-0025` §4.5:

```
equivalent across 12 validator-chosen input(s) [one-at-a-time over 2 numeric variable(s) x 6 value(s)]
```

**Bound behaviour, stated because it is a real trade:** `MAX_SETS` is a soft
ceiling. With many variables the per-variable spread shrinks, never the set of
variables, and never below `MIN_SPREAD_PER_VAR`. So with enough variables the
ceiling is exceeded rather than leaving a variable unvaried. The requirement
from §4.1 wins over the budget; that is a deliberate choice and not an oversight.

**Sorting is not the fix.** §4.4 is explicit that sorting `freeVars` and still
varying only the first would not count — it would make *which* variable is
missed stable rather than caller-controlled. Sorting is here only so the
generated inputs do not depend on caller order; varying all of them is what
makes the result correct. Drill 1 exists to show that the sort alone does not
carry the fix: with the sort in place and first-only restored, 001 goes red.

## 002 is a separate root cause and is fixed separately

Per §5. The 001 fix generates more inputs; that alone would **not** fix 002,
because the new inputs would still be dropped when the candidate fails on them.
002's fix is in the outcome classification, not the input generation:

- both sides ok → compare
- exactly one side ok → **divergence**, return `equivalent: false`, naming which
  side failed and why
- neither side ok → the input really is unusable; **counted** and reported in
  `detail`, not dropped silently

Drill 3 confirms the separation: restoring only the silent drop turns 002's
tests red and leaves 001's green.

## Cost

Each input costs two Python processes. The old rule generated 6 sets (plus the
LLM's own); the new rule generates variables × values. For the two-variable
cases in the tests that is 12 minus duplicates. The acceptance test with three
variables runs 18. That is the price of covering every variable, and `MAX_SETS`
is what keeps it from growing without a stated limit.

## Status

Not `READY_FOR_RETEST` on my own say-so — that transition is made on the Board.
`V` remains undisclosed until 岑衡's ruling.
