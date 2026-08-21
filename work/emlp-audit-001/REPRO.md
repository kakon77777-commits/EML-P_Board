# EMLP-AUDIT-001 — repro

- location: `packages/ai-converter/src/validator.ts:112`
- baseline: `f77a43f`
- board status snapshot (2026-08-20): `REPRODUCED` @ `EMLP-RELAY-0010`
- covers `EMLP-AUDIT-002` as well; the two share a test file because they share
  the same loop and the same test inputs

## The mechanism

`validateEquivalence` builds its own inputs when every free variable is numeric:

```ts
const SPREAD = ['2', '3', '5', '7', '11', '4'];
...
const first = freeVars[0]!.name;
testSets = SPREAD.map((v) =>
  freeVars.map((fv) => `${fv.name} = ${fv.name === first ? v : '3'}`).join('\n'));
```

**Only `freeVars[0]` varies. Every other numeric free variable is pinned to the
literal `'3'` for the whole run.**

`freeVars` comes from `parseFreeVars`, which walks the LLM's own binding lines
in order and keeps first occurrence. So *which* variable gets exercised is
decided by **the order the LLM wrote its bindings in**.

## Witness

| | |
|---|---|
| original | `result = a + b` |
| candidate | `result = a + 3` |
| LLM bindings | `a = 1\nb = 3` |

The candidate has dropped `b` and folded in a constant — the same constant the
validator pins `b` to. Every input the validator generates has `b = 3`, so:

| input | original | candidate |
|---|---|---|
| a=2,b=3 | 5 | 5 |
| a=3,b=3 | 6 | 6 |
| a=5,b=3 | 8 | 8 |
| a=7,b=3 | 10 | 10 |
| a=11,b=3 | 14 | 14 |
| a=4,b=3 | 7 | 7 |
| a=1,b=3 (LLM's own) | 4 | 4 |

Seven usable inputs, seven distinct original values, so the discrimination
check at line 141 is satisfied — `usable.length >= 2` and `distinct >= 2`.
Result: **`equivalent: true`**.

At `b = 4` the original gives `a + 4` and the candidate `a + 3`. The programs
are not equivalent and no generated input can show it.

## Why this is stronger than "only the first variable is varied"

The control in the test file runs **the same two programs** through **the same
validator**, changing nothing but the order of the LLM's bindings:

```
['a = 1\nb = 3']   ->  equivalent: true    (certified, wrongly)
['b = 1\na = 3']   ->  equivalent: false   (caught)
```

So the verdict on a fixed pair of programs is a function of **the order the
model happened to emit its bindings in** — which is the one input the validator
was explicitly designed not to trust:

> CRITICAL: it does NOT trust the LLM's own test inputs (conflict of interest —
> the same model proposed the suggestion).
> — `validator.ts`, the doc comment above the function

The distrust is implemented for the binding *values* and not for the binding
*order*, and the order selects which variable is ever exercised.

## EMLP-AUDIT-002, same loop

```ts
if (!a.ok || !b.ok) continue; // skip unusable inputs (errors, timeouts)
```

| | |
|---|---|
| original | `result = a * 2` |
| candidate | `if a == 7:\n    raise ValueError('boom')\nresult = a * 2` |
| LLM bindings | `a = 1` |

`a = 7` is one of the validator's own SPREAD values. The candidate raises there,
`runPython` reports not-ok, and the input is `continue`d — leaving no trace in
`usable`, in the count, or in the returned detail. The other six agree.
Result: **`equivalent: true`**.

The candidate introduces an exception on an input the original handles, and
the only input that would have shown it is the one that gets dropped **because**
it showed it.

## Running it

The test lives here as the work-in-progress artifact. To run it, copy it into
the language repo and run vitest there:

```bash
cp failing-test.ts "<eml>/tests/emlp-audit-001-002.test.ts"
cd "<eml>" && npx vitest run tests/emlp-audit-001-002.test.ts
```

It is **not committed to the language repo** — per the arrangement, work stays
here until the formal version goes back.

## Red output against baseline

Captured 2026-08-20 against `f77a43f` (product code unchanged since baseline,
verified three ways — see `findings/INDEX.md`):

```
× EMLP-AUDIT-001 ... certifies a candidate that ignores the second variable entirely
  → expected true to be false // Object.is equality
✓ EMLP-AUDIT-001 ... the same pair IS distinguishable, so the defect is the input choice
× EMLP-AUDIT-002 ... certifies a candidate that raises where the original does not
  → expected true to be false // Object.is equality
✓ EMLP-AUDIT-002 ... NULL control: an equivalent pair over the same inputs is certified

Test Files  1 failed (1)
     Tests  2 failed | 2 passed (4)
```

**2 red, 2 green.** The two green ones are there so the two red ones cannot be
read as "the validator rejects everything": one shows the same program pair is
distinguishable under a different binding order, the other shows a genuinely
equivalent pair is still accepted.

## Scope, ruled 2026-08-20

`EMLP-RELAY-0025` §3 folded the binding-order witness **into 001**, not into a
new finding: same dataflow, same root cause, and splitting it would let one half
be closed alone. The finding's description is therefore:

> validator 只變動由 LLM binding 行序選出的第一個 numeric free variable，使未被
> 選中的變數可被候選程式忽略，且 verdict 對同一 binding map 的序列化順序不穩定。

002 stays a separate root cause (§5): 001 is input-generation coverage and
external order control, 002 is outcome filtering.

## Patch

`patch.diff` — 73 insertions, 8 deletions in `validator.ts`. Drills and their
red output in `DRILL.md`; the measured order-dependence table and what the fix
is *not* claiming in `NOTES.md`.

Status is not transitioned here. `V` stays undisclosed until 岑衡's ruling.
