# Drills — EMLP-AUDIT-003 and 004

Eleven deliberate mutations, each restoring ONE piece of the pre-patch
behaviour. Actual red output recorded, not "the drill passes".

Harness restores the emitter from a pristine copy after every drill and
verifies it is byte-identical at the end.

## Control — patched, unmutated

```
Tests  18 passed   red=0
```

## 003 — three mechanisms, seven mutations

```
D1 binary: nonAssoc back to -,/,% only
   Tests  2 failed | 16 passed
     × mechanism 1, float + keeps an equal-precedence right operand grouped
     × mechanism 1, float * keeps an equal-precedence right operand grouped

D2 comparison: drop orEqual on the LEFT operand
   Tests  2 failed | 16 passed
     × mechanism 2, comparison in LEFT position keeps its parentheses
     × no EML source emits a Python comparison chain

D3 comparison: drop orEqual on the RIGHT operand
   Tests  2 failed | 16 passed
     × mechanism 2, comparison in RIGHT position keeps its parentheses
     × no EML source emits a Python comparison chain

D4 comparison: drop orEqual on BOTH operands (the original defect)
   Tests  3 failed | 15 passed
     × mechanism 2, comparison in LEFT position keeps its parentheses
     × mechanism 2, comparison in RIGHT position keeps its parentheses
     × no EML source emits a Python comparison chain

D5 membership: ELEMENT back to a bare emitExpression
   Tests  2 failed | 16 passed
     × mechanism 3, membership ELEMENT keeps its parentheses
     × no EML source emits a Python comparison chain

D6 membership: COLLECTION back to a bare emitExpression
   Tests  1 failed | 17 passed
     × mechanism 3, membership COLLECTION keeps its parentheses

D7 membership: BOTH back to bare (the original defect)
   Tests  3 failed | 15 passed
     × mechanism 3, membership ELEMENT keeps its parentheses
     × mechanism 3, membership COLLECTION keeps its parentheses
     × no EML source emits a Python comparison chain
```

## 004 — three sites and one over-fix

```
D8  except binder back to raw
   Tests  1 failed | 17 passed
     × except-as binder matches its reads

D9  with binder back to raw
   Tests  1 failed | 17 passed
     × with-as binder matches its reads

D10 remove class-attribute suppression
   Tests  1 failed | 17 passed
     × class-body assignment stays a class attribute the reader can reach

D11 OVER-fix: alias the decorator keyword too
   Tests  1 failed | 17 passed
     × a decorator keyword names the callee parameter, not a local binding
```

```
restored byte-identical: True
```

## Mechanism counts

| drill | red | all within its own mechanism |
|---|---|---|
| D1 | 2 | float only; 0 from comparison, membership, 004 |
| D2 / D3 | 2 each | one comparison cell + the class-level chain guard |
| D4 | 3 | both comparison cells + the chain guard |
| D5 | 2 | membership element + the chain guard |
| D6 | 1 | membership collection only |
| D7 | 3 | both membership cells + the chain guard |
| D8 / D9 / D10 | 1 each | one 004 site only |
| D11 | 1 | the decorator control only |

Cross-contamination between 003 and 004 is **zero** in both directions.

The chain guard (`no EML source emits a Python comparison chain`) fires for any
mutation that produces a chain. That is intended: it is a class-level assertion
about the whole output, not a cell, and EML rejects `a < b < c` at parse time so
a chain can only ever be an emitter artefact.

## D11 is the one that matters most

`emitter.ts:174` is **reachable** (decorator arguments) and must stay unaliased,
because the name belongs to the callee's signature. D11 applies the tempting
"fix" — alias it too — and the control turns red. Without that control, an
over-fix would have looked like completeness.
