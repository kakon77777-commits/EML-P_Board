# Drills — EMLP-AUDIT-001 and 002

Required by `EMLP-RELAY-0025` §4.6. Each drill restores the pre-patch behaviour
and records the **actual red output**, not "the drill passes".

Mechanism counts are reported per `PROTOCOL.md`: a breakage point that is never
reached and one that is correctly caught look identical otherwise.

---

## Drill 1 — restore first-only sampling, keeping the sort

Mutation: `for (const target of ordered)` → `for (const target of [ordered[0]!])`

```
× 001 certifies a candidate that ignores the second variable entirely
× 001 acceptance §4.2 verdict is invariant under permutation of the binding lines
× 001 acceptance §4.1 a candidate ignoring the THIRD of three variables is caught
  Tests  3 failed | 7 passed (10)
```

**Mechanism count: 3 of 3 aimed at 001 fired. 0 of 4 aimed at 002 fired.**

The second half is the point — the drill kills only its own finding's tests, so
the two test sets are independently aimed and 002's greenness is not being
carried by 001's fix.

---

## Drill 2 — restore the true pre-patch behaviour (unsorted **and** first-only)

Mutation: as drill 1, plus `ordered.map(...)` → `freeVars.map(...)`, i.e. exactly
the code at baseline `f77a43f`.

```
× 001 certifies a candidate that ignores the second variable entirely
  → expected true to be false // Object.is equality
× 001 acceptance §4.2 verdict is invariant under permutation of the binding lines
  → expected true to be false // Object.is equality
× 001 acceptance §4.1 a candidate ignoring the THIRD of three variables is caught
  → expected true to be false // Object.is equality
  Tests  3 failed | 7 passed (10)
```

**Mechanism count: 3 of 3 aimed at 001. 0 of 4 aimed at 002.**

### A check on this drill, because the failure message is ambiguous

§4.2 asserts two things:

```ts
expect(one.equivalent).toBe(two.equivalent);   // invariance
expect(one.equivalent).toBe(false);            // and both must be false
```

Under this mutation `one = true` and `two = false`, so the **first** assertion
fails — and `expect(true).toBe(false)` prints the same message the second
assertion would print if it were the one failing. The message alone cannot say
which half went red.

Rather than infer it, the four combinations were measured directly under the
mutated build (see `NOTES.md`). The invariance assertion is the one that fires.

---

## Drill 3 — restore the silent drop for one-sided failures

Mutation: the `if (a.ok !== b.ok)` divergence branch → `{ continue; }`

```
× 002 certifies a candidate that raises where the original does not
× 002 acceptance names the failing side in the detail
× 002 acceptance catches the reverse: the candidate swallows an error the original raises
  Tests  3 failed | 7 passed (10)
```

**Mechanism count: 3 of 3 aimed at 002 fired. 0 of 6 aimed at 001 fired.**

Symmetric to drills 1 and 2: 002's mechanism kills only 002's tests. Per
`EMLP-RELAY-0025` §5 the two root causes must not be conflated, and this is the
evidence that they are not — fixing one does not make the other's tests green.

---

## What these drills do not establish

`count > 0` establishes **reachability** only (`PROTOCOL.md`, sharpened by
`EMLP-RELAY-0025` §5.2). Discrimination needs the red output above **and** the
NULL controls in the test file, which are:

- `001` — the same program pair IS distinguishable under a different binding
  order, so the certification is about the inputs and not about the programs;
- `002` — a genuinely equivalent pair is still accepted, so the new divergence
  branch is not simply rejecting everything;
- `002` — an input unusable on **both** sides is counted and reported, not
  turned into a false divergence.

All three are green after the patch and are not touched by any drill above.


---

# Round 2 drills — after 岑衡's EMLP-RELAY-0028 escape

## The drill that did not fire, and what it cost to notice

Restoring the `allNumeric` gate — **the exact hole she found** — and re-running
her verification file gave **13 passed, 0 failed**.

Her mixed-binding test went green under the mutation. Not because coverage was
restored, but because with the gate back the mixed case falls through to the
**fail-closed** branch, which also returns `equivalent: false`. Her assertion is
`toMatchObject({ equivalent: false })`, and both routes satisfy it.

So that test cannot distinguish:

| fix | her mixed test | what it does to legitimate mixed input |
|---|---|---|
| (a) extend numeric coverage across mixed bindings | green | still certifies correctly |
| (b) refuse to certify anything with a non-numeric variable | green | refuses every mixed pair |

Those are very different products. A handback claiming "the drill fires" would
have been claiming something the drill cannot see.

## The control that separates them

A **genuinely equivalent** mixed pair must still come back `equivalent: true`.
Fix (a) certifies it; fix (b) cannot. Three tests added:

- still CERTIFIES an equivalent mixed numeric/string pair
- the `detail` reports the numeric coverage *and* the held non-numerics
- fails closed only when **every** free variable is non-numeric

## Drill A — restore the `allNumeric` gate

Mutation: `if (numericVars.length > 0)` → `if (numericVars.length > 0 && otherVars.length === 0)`

```
× still CERTIFIES a genuinely equivalent mixed numeric/string pair
× reports that the numeric variables were covered despite the string one
  Tests  2 failed | 14 passed (16)
```

**Mechanism count: 2 of 2 coverage tests fired. The fail-closed test did not,
and should not — that mechanism is untouched.**

## Drill B — remove the fail-closed branch

Mutation: `generatedNothing = true` → `false`, i.e. certify on LLM-supplied
inputs when nothing could be generated.

```
× fails closed when EVERY free variable is non-numeric
  Tests  1 failed | 12 passed (13)
```

**Mechanism count: 1 of 1. Neither coverage test fired.** The two mechanisms
are independently aimed.

## One ordering defect found by the fail-closed test

The first version put the `generatedNothing` check just before the final
`equivalent: true`. The **discrimination** check returns before that, so an
all-string case came back with `could not confirm - test inputs do not exercise
the computation` — which blames the inputs, when the real reason is that the
validator could not generate any.

Moved ahead of the discrimination check and behind the agreement loop, so a
real disagreement is still conclusive `false` and everything else fails closed
with the accurate reason.
