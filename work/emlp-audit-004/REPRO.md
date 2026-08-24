# EMLP-AUDIT-004 — reproduction

- reproduced by: session `ai-57`, 2026-08-25
- against: `efficientnewlanguage` HEAD `f3e4d93`
- location as filed: `packages/transpiler-python/src/emitter.ts:214`
- **second live site found: `emitter.ts:230`**
- failing test: `work/emlp-audit-004/failing-test.ts` — **3 red**

## Mechanism

Identifier reads are aliased (`emitter.ts:75`):

```ts
case 'Identifier':
  return aliasIdentifier(expr.name);
```

`def` parameters are aliased (`emitter.ts:256`). Binders are not:

```ts
214:  ? `except ${h.exceptionType} as ${h.name}:`
230:  ? `with ${emitExpression(stmt.contextExpr)} as ${stmt.target.name}:`
```

Both interpolate `.name` raw. A binder named `list` is written `list` and read
`lst`.

## Measured — this one crashes, it does not diverge quietly

```
except ValueError as list:
    print("caught: " + str(lst))

NameError: name 'lst' is not defined. Did you mean: 'list'?
```

Same for `with`:

```
with open("x.txt") as list:
    print("got: " + str(lst))
```

## Scope: the filed location is one of two

The finding names line 214. Line 230 has the identical defect and is not
mentioned. A patch that fixes only 214 leaves `with` broken, and the filed
test would still go green — so the test asserts the **class** (a binder and its
reads must emit the same name), not the two instances.

## A third site that is latent, not live

`emitter.ts:174` emits keyword-argument names raw:

```ts
.map((a) => (a.name !== undefined ? `${a.name}=${emitExpression(a.value)}` : ...))
```

I could not construct EML source that reaches it. `pick(list=5, n=2)` does not
parse as a keyword call — it parses as comparisons and emits
`pick(lst == 5, n == 2)`. So EML appears to have no keyword-argument call
syntax and the branch is unreachable from EML source.

Recorded as **latent, reachability not demonstrated** rather than as a third
site. If another front end can produce that AST node, it becomes live.

Separately observed and NOT filed as a finding: `list=5` silently becoming
`list == 5` means something that looks like a keyword argument compiles to a
comparison. That is a parser-surface question, out of scope here.
