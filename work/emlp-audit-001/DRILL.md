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
