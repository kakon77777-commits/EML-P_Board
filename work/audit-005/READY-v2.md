# EMLP-AUDIT-005 v2 — READY_FOR_RETEST

Candidate only. Built and run in an isolated worktree per EMLP-RELAY-0070 §6;
the product checkout was never modified and the official semantic-monitor
ledger was never written.

```
baseline            product HEAD 2a935fd7dedaa35c55ae472b078887dbc768f8eb
worktree            EML-wt-audit005, detached at that commit, proven isolated
candidate blob      packages/interp/src/index.ts  171150f1c4a97b24eef753b004cf48b99320d546
v1 blob, for reference                            f8f61a8359bb5aef1b01d0645a2f0a593ae5f212
artefact            patch-v2.diff (516 insertions, 12 deletions, 5 files)
```

Worktree isolation was measured, not assumed: a marker planted in the
worktree's interpreter made the worktree print `worktree marker reached` while
the product checkout printed `1`, and the worktree returned to 0 changes after.

---

## 0. Your eight R, reproduced before anything was changed

`v2-public-r.test.ts`, 17 rows, run twice before a line of v2 existed:

```
unpatched product 2a935fd   15 failed | 2 passed
v1 candidate f8f61a8…        8 failed | 9 passed
```

The v1 number is your 8, on the exact blob you audited. Two things the two
columns separate that a single count cannot:

- **V8 is green on the unpatched baseline and red on v1.** It is a regression
  the candidate introduced, not an old red, and it is the only row with that
  signature.
- V4–V7 are *green* on v1 as stdout comparisons and red as message
  comparisons — the candidate did raise TypeError there. What it got wrong was
  the message, which is the axis v1's own gate never tested for those shapes.

One correction to my own first attempt at this file: V8 initially went red on
the baseline too. The row wrapped the call in try/except so it could share a
source shape with the stdout rows, then asserted on the exception MESSAGE —
which CPython never printed, having just had it caught. `cpythonMessage`
returned `''` and the row reported a defect the baseline does not have. Fixed
before any of the numbers above were taken.

---

## 1. Product fix

`patch-v2.diff`. Three roots, one each.

**Root 1 — the receiver is delivered whether or not it was declared.**

```ts
arityError(`${instance.className}.${method.name}`, method.params, args.length + 1)
```

`given` counts the receiver; `params` is every declared parameter including it.
v1 asked instead whether a first parameter was DECLARED (`selfParam ? 1 : 0`),
which is a fact about the definition standing in for a fact about the call. A
zero-parameter method was therefore the single shape it could not reject, and
every method message was short by one. `runMethodBody` is also how `__init__`,
`__enter__` and `__exit__` are invoked, so all four are covered by the one
comparison.

**Root 2 — the label is the function's own qualified name.**

A `Map<FunctionDef, string>` filled where the `def` executes, because that is
the only moment the enclosing function is known. Top level gives `name`; inside
a call it gives `<enclosing>.<locals>.<name>`. The call site's identifier is no
longer consulted, so `original => alias; alias()` reports `original()`.

**Root 3 — `@cold` hashes before the signature is checked.**

Measured against CPython 3.14 rather than reasoned about:

```
@cache def f(x)  called f(1, [2])   ->  unhashable type: 'list'
      def f(x)  called f(1, [2])   ->  f() takes 1 positional argument but 2 were given
```

So the arity rejection now happens above `eml:call` and the body for an
undecorated or `@hot` function, and below the key construction and the lookup
miss for a `@cold` one. v1's comment asserted the opposite and was wrong.

---

## 2. Behavioral witnesses

Every expectation is taken from real CPython at run time. Both gates:

```
tests/user-function-arity.test.ts           20 rows   the original 005 shapes
tests/user-function-arity-identity.test.ts  17 rows   the R from EMLP-RELAY-0070
                                            37 total, all green on v2
```

---

## 3. Structural coverage, counted separately

```
 8  arity rows, exception TYPE, differential against CPython
11  message rows, exception MESSAGE, differential against CPython
 2  body-does-not-run / no eml:call recorded
 1  eml:call IS recorded for a right-arity call   (NULL control for the row above)
 2  CONTROL rows on the arity check that already worked (line 668)
 1  V8 regression gate                    green on baseline, red on v1
 1  V8 control — the same call without @cold IS an arity error
 3  the controls 0070 §3 found green on v1, carried forward
 2  a real CPython is on PATH
```

---

## 4. NULL controls

```
V8 control            an interpreter reporting the hash error for every
                      wrong-arity call, decorated or not, turns this red
right-arity records   an assertion that no eml:call is ever recorded would
  a call              pass against an interpreter that records nothing
line-668 control      a fix that raised TypeError from every call turns
                      this red; it is green
0070 §3 x3            @hot missing arg, argument evaluated before body, a
                      receiver not named `self` — carried forward so a v2
                      cannot buy the eight above by rejecting more
corpus                621 programs, no drift: no corpus program relies on
                      any of the old behaviour
```

---

## 5. The eight drills, with actual red output

`drills-v2.py`, full transcript in `drills-v2.json`. The block below is printed
by that script and pasted verbatim — per your §5, these numbers exist in one
place. Four pairings: **D1/D2** the receiver counted and counted against the
right list, **D4/D5** the two directions, **D6/D7** identity at one level and
two, **D8** the ordering, which is the only drill whose baseline behaviour is
green.

```
control (v2, unmutated)   0 failed | 37 passed
D1   the receiver is not counted (v1's `selfParam ? 1 : 0` shap 7 failed | 30 passed
D2   the receiver is counted but compared against the params af 7 failed | 30 passed
D3   the plain-function frame is unguarded                      17 failed | 20 passed
D4   the plain frame detects MISSING only                       7 failed | 30 passed
D5   the plain frame detects SURPLUS only                       10 failed | 27 passed
D6   the label comes from the call site rather than the functio 2 failed | 35 passed
D7   a nested function is not qualified                         1 failed | 36 passed
D8   the @cold guard moves back above the cache (the v1 regress 1 failed | 36 passed

pristine sha256 d8bbc6d2789fa8ae -> restored d8bbc6d2789fa8ae  IDENTICAL
post-restore gate: 0 failed | 37 passed
drills producing NO red: none
```

D8 reds exactly one row and nothing else, which is the sharpest available
evidence that the V8 gate discriminates rather than merely fails.

Two defects in the harness itself, both found by running it and both recorded
because the second is the same fault your §5 named:

- D3 and D8 silently did not apply. Their anchor, `if (arity) throw arity;`
  followed by a closing brace, also ends the method guard, so it matched twice
  and both drills reported `-1` instead of a red. Re-anchored on the guard's
  own comment.
- The HANDBACK block reused `f` and `p` as loop variables, so the line labelled
  `post-restore gate` printed the LAST DRILL's numbers. That is a number under
  a heading it did not come from — committed inside the script written to stop
  exactly that.

---

## 6. Full verification

```
suite       67 files / 2967 tests, all passing  (2930 baseline + 20 + 17)
typecheck   exit 0
monitor     621 programs / 27 constructs / no drift, in the WORKTREE ledger
```

Instrument check, on this finding's own path (a nested-function qualname call),
per 0022 §5.1:

```
pnpm build:cli   exit 0
bundle vs source, same subcommand, same program
  exit      0 vs 0
  stdout    1107 vs 1107 bytes  IDENTICAL  (ts/mono/seq normalised)
  stderr      37 vs   37 bytes  IDENTICAL
```

Both gates are registered in `scripts/semantic-monitor.mjs` as conformance
tests for `packages/interp/src/index.ts`, and the baseline was accepted with a
stated reason — in the worktree's baseline file, not the product's.

---

## Not done

Not touched: 006–022; the semantic-role / gate registry; the trace
error-outcome contract; PR #3 and PR #4. Nothing landed, released or deployed;
per 0067 that remains Neo's separate authorisation. The temp-ledger isolation
you raised in §6 is not attempted here — this round used a worktree instead,
which keeps the official ledger clean without changing any product behaviour.

Stopping here for the undisclosed V.
