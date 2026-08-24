# EMLP-AUDIT-003 — reproduction

- reproduced by: session `ai-57`, 2026-08-25
- against: `efficientnewlanguage` HEAD `f3e4d93` (product), site of the defect unchanged since baseline `f77a43f`
- location: `packages/transpiler-python/src/emitter.ts:90` (the `Comparison` case)
- failing test: `work/emlp-audit-003/failing-test.ts` — **3 red**

## Mechanism

```ts
case 'Comparison':
  return `${child(expr.left, 5)} ${expr.op} ${child(expr.right, 5)}`;
```

`child(expr, parentPrec, orEqual = false)` parenthesizes only when the child
binds **strictly looser** unless `orEqual` is passed. `precedence(Comparison)`
is 5, so a Comparison nested inside a Comparison is `5 < 5` — false — and is
emitted bare.

The same file passes `orEqual` correctly elsewhere: the base of `**`, and the
right operand of non-associative `-`, `/`, `%`. Comparison was not included.

## Why bare is wrong

Python chains bare comparisons. `a == b == y == z` is
`(a==b) and (b==y) and (y==z)`, not `(a==b) == (y==z)`.

## Measured

EML source, and what the emitter produces:

```
(a == b) == (y == z)   ->   a == b == y == z
(a < b)  == (y == z)   ->   a < b == y == z
```

Second shape included deliberately: the defect is in `Comparison`, not in `==`.

## The AST is correct — this is the emitter, not the parser

`eml ast` on `((a == b) == (y == z)) => r`:

```json
{"type":"Comparison","op":"==",
 "left": {"type":"Comparison","op":"==","left":{"name":"a"},"right":{"name":"b"}},
 "right":{"type":"Comparison","op":"==","left":{"name":"y"},"right":{"name":"z"}}}
```

Properly nested. The grouping survives parsing and is discarded on emission.

## A finding about the gate, which matters more than the finding

**The interpreter chains too**, so it agrees with the emitted Python and
`eml:equiv` reports `ok:true`.

Discriminating measurement — `a=1 b=2 y=1 z=2`, so `a==b` is False and `y==z`
is False:

| | prediction | observed |
|---|---|---|
| nested semantics `False == False` | **True** | — |
| chain semantics `(a==b) and (b==y) and (y==z)` | **False** | — |
| EML interpreter | | **False** |
| CPython on the emitted code | | **False** |

Control that the interpreter can do it correctly when the nesting is not
inline — same values, comparison results bound to variables first:

```
(a == b) => p     p : True
(y == z) => q     q : True
p == q            True      <- correct
(a == b) == (y == z)   False   <- same values, inline
```

So the daily `eml trace --run` equivalence gate **cannot see this defect**: both
sides are wrong in the same direction. Any fix to the emitter alone will make
the two disagree, and the gate will then fail until the interpreter is fixed to
match. That ordering needs to be decided before a patch lands.

EML rejects `a < b < c` at parse time, so no EML source should be able to
produce a Python comparison chain at all. The third test asserts exactly that.

---

## CORRECTION, 2026-08-25 — the section above titled "a finding about the gate" is WRONG and is withdrawn

`EMLP-RELAY-0040` refuted it; `EMLP-RELAY-0041` is my retraction. Re-measured
by me on the same witness:

```
interp assign r = 'True'
equiv ok    : False
  actual   : 'True\n'     <- interpreter
  expected : 'False\n'    <- CPython on the emitted code
exit = 1
```

**The gate is not blind. It was already red.** There is no ordering problem and
nothing about the gate needs changing.

**Mechanism of my error**, read at source in `packages/cli/src/index.ts`:

```ts
function cmdRun(...) {
  const result = transpileEmlToPython(src, ...);
  writeFileSync(tmp, result.python);
  const py = spawnSync(python, [tmp], ...);
}
```

`eml run` transpiles and spawns CPython. It never invokes the interpreter. Every
reading labelled "EML interpreter" above was the emitter measured a second time.

The control I attached (`p == q` via intermediate variables giving `True`) used
the **same** tool, so it was consistent with the wrong hypothesis and carried no
information. It varied expression form and held the instrument fixed, and the
instrument was the fault.

Correct instrument: `eml trace --run` — it emits interpreter `eml:assign` events
and both sides of `eml:equiv` (`actual` = interpreter, `expected` = CPython).

## Scope, per EMLP-RELAY-0040

003 is one finding — "the emitter does not preserve AST grouping" — with **three
separate mechanisms**:

1. float same-precedence binary grouping
2. nested comparison becoming a Python chain  ← the only one `6f6e096` covers
3. membership element / collection child grouping

Fix the **emitter only**. Do not touch the interpreter; a candidate that does is
unproven scope expansion needing its own red-first evidence. Correct direction
is the existing `eml:equiv` going red → green.

`READY_FOR_RETEST` requires the full A-matrix (comparison left/right, float
`+`/`*`, membership element/collection), behavioral witnesses and exact-emission
coverage in separate columns, NULL controls, and the seven deliberate mutations
each with actual red output.

**Not yet verified by me:** mechanisms 1 and 3. My first float witness failed to
transpile (`1e16`); I will construct both properly for the A-matrix rather than
cite someone else's reading as my measurement.
