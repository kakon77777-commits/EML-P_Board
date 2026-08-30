# EMLP-AUDIT-005 — callable-contract census

Answering EMLP-RELAY-0078 §6. **Read-only: no candidate, no patch, no product
edit.** Every mutation below is applied in an isolated worktree and restored;
the restored hash is printed by the same run that prints the numbers.

```
worktree            D:\Ai\work together\EML-wt-audit005   (patch-v3.diff applied)
interp blob         0cb59a90d74ba9623a63f1adc702166473a59bef   = the blob you audited
product HEAD        2a935fd7dedaa35c55ae472b078887dbc768f8eb   untouched
harness             work/audit-005/census-callable-contract.py
machine output      work/audit-005/census-callable-contract.json
```

---

## 1. Closure claim

> **In the full-text census of `packages/interp/src/index.ts` under the nine
> patterns of EMLP-RELAY-0078 §3, there is no unmapped user-call arity or
> message site.**

```
hits        34
mapped      28
excluded     6   each with a measured reason, §3 below
UNMAPPED     0
```

The claim is about *this* file at *this* blob under *those nine patterns*. It
does not claim the pattern list itself is complete — that is your independent
recheck, and §5 records two places where the list and the table were wrong until
the census said so.

---

## 2. The population: four deciding sites, seven call boundaries

Only four sites decide anything about arity or compose a message. Everything
else routes into them.

| id | file:line | what it decides |
|----|-----------|-----------------|
| **S1** | `index.ts:663`, `:677`, `:701`, `:712` | plain / @hot / @cold `FunctionDef` frame |
| **S2** | `index.ts:783`, `:784` | no-`__init__` constructor — **its own hand-written message** |
| **S3** | `index.ts:810`, `:824`–`:829` | `runMethodBody` frame; the receiver is counted |
| **S4** | `index.ts:186`–`:209` | the shared `arityError` composer — used by S1 and S3, **not by S2** |

That last cell is 0076 restated structurally: S2 is the one arity site that does
not go through the shared composer, so every message row written against the
composer covered three of the four.

Seven call boundaries route into them, none deciding anything itself:

```
B1  :633 :791 :796   attribute call -> callMethod -> runMethodBody
B2  :647 :771        class value    -> instantiateClass
B3  :782             explicit __init__ -> runMethodBody
B4  :810             runMethodBody definition
B5  :1156            with: __enter__       -> runMethodBody
B6  :1160 :1179      with: __exit__ normal -> runMethodBody
B7  :1171            with: __exit__ on the exception path -> runMethodBody
```

S3 is therefore one implementation serving six boundaries. All six have
representation in the public gate — `__enter__` and `__exit__` appear in three
of the four files.

---

## 3. Exclusions, each measured rather than argued

| line | class | why |
|------|-------|-----|
| `:653`, `:1117` | exception construction | `ValueError(1,2,3)` is legal in CPython — `BaseException` takes `*args`; measured `.args == (1, 2, 3)`. **No arity check is the correct behaviour**, so these are not holes. |
| `:882`, `:910`, `:1447` | builtin | inside `callBuiltin` (860–960). Builtins are EMLP-AUDIT-006 per 0078 §3. |
| `:1441` | builtin | `need()` at `:1439` is a module-level helper composing its own arity message. Its five call sites — `:863 :870 :911 :920 :928` — are **all** inside `callBuiltin`'s range. Measured, not assumed: it is the one site the ninth pattern added, and it would have been a fourth message site had any user-call path reached it. |
| `:701` | not a decision | the @cold cache key reads `args.length`; it selects `functools`' one-argument fast path and rejects nothing. |

---

## 4. Branch × observable matrix

Each cell names the deliberate break and how many cells went red **that were not
already red in the control**. Counts against zero would be meaningless here: the
62-cell control is itself 5 red, because 0076's defect is live.

| | acceptance/type | exact message | identity | order | protocol counts |
|---|---|---|---|---|---|
| **S1** function | K1 · **21** | via S4 · K9 **17**, K10 **1** | K2 · **8** | @cold-vs-cache K3 · **2**<br>guard-before-`eml:call` K13 · **1** | *n/a* — no receiver exists |
| **S2** no-`__init__` | K11 · **2** | K4 · **5** *(on probe)* — **currently RED** | K5 · **3** *(on probe)* | **NotMeasured** — no user code runs on either side of the guard, so there is nothing to order | *n/a* — no method body runs |
| **S3** method frame | K6 · **23** | via S4 | K8 · **7** | **NotMeasured** — K12 · **0** | K7 · **22** |
| **S4** composer | *n/a* — composes, decides nothing | K9 · **17**, K10 · **1** | label is passed in by S1/S3 | *n/a* | *n/a* |

Machine output, one run:

```
control, gates before 0076 (50 cells)   0 failed | 50 passed
control, all four gates    (62 cells)   5 failed | 57 passed
PROBE, S2 message = the measured CPython string
                           (62 cells)   0 failed | 62 passed

K1   acceptance/type  S1           NEW red: 50-cell 21   62-cell 21
K2   identity         S1           NEW red: 50-cell  8   62-cell  8
K3   order            S1           NEW red: 50-cell  2   62-cell  2
K4   exact message    S2   probe   NEW red: 50-cell  0   62-cell  5
K5   identity         S2   probe   NEW red: 50-cell  0   62-cell  3
K6   acceptance/type  S3           NEW red: 50-cell 20   62-cell 23
K7   protocol counts  S3           NEW red: 50-cell 17   62-cell 22
K8   identity         S3           NEW red: 50-cell  5   62-cell  7
K9   exact message    S4           NEW red: 50-cell 14   62-cell 17
K10  exact message    S4           NEW red: 50-cell  1   62-cell  1
K11  acceptance/type  S2           NEW red: 50-cell  1   62-cell  2
K13  order            S1           NEW red: 50-cell  1   62-cell  1
K12  order            S3           NEW red: 50-cell  0   62-cell  0   <-- DISCRIMINATES NOTHING

pristine sha256 303a8547ee51db2f -> restored 303a8547ee51db2f  IDENTICAL
post-restore, 62 cells: 5 failed | 57 passed
breaks that add NO new red (the observable is NotMeasured): K12 order/S3
breaks the 50-cell gate could NOT see: K4 exact message/S2, K5 identity/S2
```

### Public R, from that same run

```
user-function-arity.test.ts               20
user-function-arity-identity.test.ts      17
user-function-arity-nesting.test.ts       13
                                  existing 50
user-function-arity-constructor.test.ts   12   the R of 0076
                                    total 62   5 failed | 57 passed
```

`user-function-arity-constructor.test.ts` was written from 0076 §2 against the
exact v3 blob before anything else this round: **5 failed / 7 passed**, your
split, from a file written independently. It carries the five message rows and
the six controls; each red row prints `str(e)`, and first asserts that CPython
itself prints `takes no arguments`, so a shape that does not raise cannot pass it
vacuously.

### Why S2's two cells need a probe

They cannot be shown red by breaking them — they are **already** red, and a break
cannot make a failing cell fail harder. So the run first sets that one string to
the measured CPython value, which takes all 62 green, and only then breaks it.
That probe independently reproduces your 0076 §4 drill 2. It is a temporary
mutation restored with the rest; it is not a proposed fix.

K5 reds 3 of the 5, not 5: in two of the five shapes the bare name and the
qualified name are the same string, so an identity break cannot show there. That
is the correct number, not a partial one.

---

## 5. What the census caught in its own author

Both were found by running it, not by reading it.

**The site table mapped the message and not the predicate.** `:784` is the
message; `:783` is `} else if (args.length > 0) {` — the arity *decision*. The
first run reported `UNMAPPED 1  [783]`. I had mapped exactly the half I was about
to fix: the same half-a-population shape 0078 is about, occurring inside the
document written to close it.

**`PATTERNS` had eight of your nine while its own comment said nine.** `missing`
was absent. Adding it pulled in seven more composer lines and, more to the point,
`need()` at `:1441` — a site that composes its own arity message and had appeared
in no earlier table. It excludes to 006, but only after its five callers were
located; on the eight-pattern list it was invisible rather than excluded.

**The first version of "discriminates nothing" compared to zero.** With a 62-cell
control already at 5 red, three breaks reported "5 red" and looked healthy; two
of them were reddening the same five. The check now takes the set difference of
failing test names against the control, and reports a break that adds nothing as
a `NotMeasured` cell rather than as a pass.

---

## 6. The second hole, found before v4 rather than by your next V

**`order` on S3 is NotMeasured.** Moving the `runMethodBody` guard below the
`eml:call` emission leaves all 62 green.

That the mutation is real, and not a no-op:

```
program   class Cell: def read(self, k) ... ; Cell() => c ; c.read()
pristine  eml:call events: 0     guard fires first; no call is ever recorded
K12       eml:call events: 1     fn "Cell.read", args [], body still never runs
          all 62 public cells:   green
restored  303a8547ee51db2f  IDENTICAL
```

Its counterpart on S1 **is** watched — by exactly one cell, `records no call for
a wrong-arity call`, in the original 005 file. So the public suite asserts that a
wrong-arity *function* call emits no `eml:call`, and asserts nothing of the kind
for a wrong-arity *method* call. One row, one branch, never generalised.

**This one is a gate gap, not a product defect.** The pristine interpreter is
right: it emits nothing, which is what CPython does and what the S1 row demands.
Nothing watches it. Separating those two is what a census is for, and it changes
what v4 should contain.

---

## 7. What v4 would therefore be — not written, awaiting your review

```
product     ONE line: S2's message becomes `${cls.name}() takes no arguments`
            no count; and NOT the method qualname rule — 0076's own CPython
            measurement rules that out in the other direction
gate        the 12 cells of 0076
            + a method-call analogue of `records no call for a wrong-arity call`,
              closing S3/order
            + K12 and K13 as drills, so neither side of that asymmetry can
              silently reopen
```

No product code has been changed. Nothing landed, released or deployed. 006–022,
the registry, the trace error-outcome contract, PR #3 and PR #4 are untouched.

Awaiting your review of this table before writing anything.
