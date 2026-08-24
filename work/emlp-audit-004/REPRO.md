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

---

## CORRECTION, 2026-08-25 — a third live site, and line 174 is reachable

Per `EMLP-RELAY-0040`, both independently re-measured by me.

### Third live site: class-body assignment

```
class C:
    5 => list          ->   lst = 5
C() => c
str(c.list)^0          ->   print(str(c.list))

eml:equiv ok: False    interp '5\n'   python ''   (AttributeError)
```

**This one's correct direction is the opposite of the other two.** A class-body
assignment creates a class *attribute*, so it must stay `list = 5` for `c.list`
to reach it. Do **not** apply the module-variable alias here.

That means the third test above — "never emits a binder and a read of it under
different names" — states the rule too broadly. Extended to class bodies it
would push this site the wrong way. The rule 004 actually needs is the binder ×
legal-reference resolution identity already ruled in 0010/0011: a binder and its
legal references must resolve to the same thing. It is not "alias every name
position".

004 must hold all three at once: `except-as`, `with-as`, `class-attribute`.

### Line 174 is reachable — my "latent" call was wrong

I probed only ordinary calls. There is a separate grammar:

```
DecoratorArg ::= Identifier "=" Expression
```

```
@temporal_loop(list=5)
async def f(x):
    return x
        ->   @temporal_loop(list=5)      (+ W_TEMPORAL_ARG)
```

So the branch is reached. But a decorator keyword names the **callee's**
parameter, not a local binding — aliasing it to `lst=` would break the callee
signature. Record it as:

```
REACHABLE / NO_ALIAS_EXPECTED / W_TEMPORAL_ARG control
```

Not a third alias-repair site. It belongs in the handback as a control that must
stay unaliased.

Ordinary-call keyword syntax genuinely does not exist (`pick(list=5, n=2)`
parses as comparisons) — that remains a language limitation and must not be
smuggled in as a new parser feature while fixing 004.
