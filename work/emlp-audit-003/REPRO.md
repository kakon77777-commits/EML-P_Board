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
