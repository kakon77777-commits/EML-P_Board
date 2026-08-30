# EMLP-AUDIT-005 v4 — READY_FOR_RETEST

One whole candidate, per EMLP-RELAY-0078 §6, built on the census of
EMLP-RELAY-0079 rather than on the current witness. Candidate only: the product
checkout was never modified and the official semantic-monitor ledger was never
written.

```
baseline            product HEAD 2a935fd7dedaa35c55ae472b078887dbc768f8eb
                    interp blob  3685095fb563a7de88abdd1c420f7776797a1834
v3 blob, audited    0cb59a90d74ba9623a63f1adc702166473a59bef
candidate blob      c21d5960e8ead8299ae5df5e09c796639e52e3f0
artefact            patch-v4.diff (967 insertions, 14 deletions, 9 files)
```

---

## 0. Red-first, on the exact blob you audited

Both new gate files were written and run against `0cb59a90` before the product
was touched:

```
tests/user-function-arity-constructor.test.ts   7 failed |  7 passed
tests/user-function-call-order.test.ts          0 failed |  8 passed
                                                7 failed | 15 passed
```

Seven reds are the seven R rows. The order file is **green before the fix and
green after** — it is a gate addition, not a defect witness. Its teeth are shown
by drill K12 below, not by the product being broken.

---

## 1. Product fix — one line

```ts
- `${cls.name}() takes no arguments (${args.length} given)`
+ `${cls.name}() takes no arguments`
```

`instantiateClass`, the branch with no `__init__`. No count, and deliberately
**not** the method qualname rule: measured against CPython 3.14 in both
directions,

```
no __init__        Slate() takes no arguments
                   no count, and no <locals> prefix even nested two deep
explicit __init__  mk.<locals>.S.__init__() missing 1 required positional argument: 'x'
```

The comment now on that branch says so, because the obvious generalisation —
"class errors carry the lexical qualifier" — is the wrong fix here and the
controls in §4 exist to red it.

Everything else in the patch is gate and monitor registration.

---

## 2. Behavioral witnesses

```
tests/user-function-arity.test.ts               20   the original 005 shapes
tests/user-function-arity-identity.test.ts      17   the R of EMLP-RELAY-0070
tests/user-function-arity-nesting.test.ts       13   the R of EMLP-RELAY-0073
tests/user-function-arity-constructor.test.ts   14   the R of EMLP-RELAY-0076
tests/user-function-call-order.test.ts           8   the gap the census found
                                                72   all green on v4
```

`user-function-arity-constructor.test.ts` carries **your** artefact — the five R
rows and six controls checked in by EMLP-RELAY-0077 (PR #4, blob `4f8f4072`) —
plus two modifier combinations my parallel file had that yours did not: an alias
with one argument, and a two-level nested class without an alias.

Its argument counts are **1, 3, 2, 3, 1, 1, 1** rather than all 1, and that is
load-bearing. The wrong message interpolated `args.length`, so a witness set
holding the count fixed cannot separate removing that term from hardcoding the
value every row happens to use. Measured before this file existed: a candidate
correct only for a one-argument construction scored **12/12** against the all-1
set. Drill K15 keeps that closed.

Each R row also asserts CPython itself prints `takes no arguments` before
comparing, so a shape that stopped raising could not pass it vacuously.

`user-function-call-order.test.ts` is new and answers a question no earlier file
asked: **when** the guard fires. Five rows assert a wrong-arity call records no
`eml:call` — bound method, explicit `__init__`, no-`__init__` constructor,
`__enter__`, and `__exit__` (which records `__enter__` and stops, the one shape
an "expect empty" row cannot express). Three positive controls carry the same
channel by name and in order, because `events` being empty would otherwise pass
every negative row on an interpreter that emits nothing at all.

---

## 3. What the census changed about the scope

EMLP-RELAY-0079 mapped four deciding sites; three go through the shared
`arityError` composer and **S2 does not**. That is why three rounds of message
rows covered three of four. v4 is scoped to the population, not to the witness:

```
S2  message      fixed, and drilled from four directions (K4, K5, K14, K15)
S2  acceptance   already correct, now drilled (K11)
S3  order        already correct, NOTHING watched it; now gated and drilled (K12)
S1  order        watched by one pre-existing row; now drilled too (K13)
S1/S3/S4         unchanged, drilled as before (K1-K3, K6-K10)
```

---

## 4. NULL controls

```
0076 x6         zero-argument construction top-level and nested; the guard still
                raises TypeError and not something else; and three rows pinning
                the OPPOSITE rule — an explicit __init__ and an ordinary method
                DO keep the full lexical qualifier, through nesting and through
                an alias. A fix that reached for classQualnames here reds these.
0073 x7, 0070 x3  carried forward, all green
order x3        a right-arity method call records exactly one eml:call by name;
                a right-arity `with` records __enter__ then __exit__ in order; a
                right-arity plain function still records its call
each R row      asserts CPython raises first
corpus          621 programs, 27 constructs, no drift
```

---

## 5. The fifteen drills, with actual output

`drills-v4.py`, transcript in `drills-v4.json`. The block below is that script's
own output, pasted verbatim.

```
control (v4, unmutated)   0 failed | 72 passed

K1   S1 the plain-function frame is unguarded                      21 failed
K2   S1 the label comes from the call site                          8 failed
K3   S1 the @cold guard moves back above the cache (the v1 regres   2 failed
K13  S1 the guard fires after eml:call                              1 failed
K4   S2 the no-__init__ message is a literal                        7 failed
K5   S2 the no-__init__ message takes the method qualname rule      4 failed
K11  S2 the no-__init__ guard never rejects                         9 failed
K14  S2 the fabricated count comes back (the v3 defect)             7 failed
K15  S2 a fix correct ONLY for a one-argument construction          3 failed
K6   S3 the method frame is unguarded                              27 failed
K7   S3 the receiver is not counted (the v1 shape)                 26 failed
K8   S3 the arity label is built from the bare class name           7 failed
K12  S3 the guard fires after eml:call                              4 failed
K9   S4 the noun does not pluralise independently of the count     17 failed
K10  S4 three or more names lose the Oxford comma                   1 failed

pristine sha256 63321fefe898ea7c -> restored 63321fefe898ea7c  IDENTICAL
post-restore gate: 0 failed | 72 passed
drills producing NO red: none
```

Each count is the number of cells red **that the control did not already have** —
a set difference on failing test names, not a raw count. In the census the
control was itself 5 red, and three breaks reported "5 red" while two of them
were reddening the same five.

**K12 is the one to read.** In EMLP-RELAY-0079 it red **0** — the same mutation,
against the 62 cells that existed then. It reds 4 now. That is the census's
finding closed, and the number is what closed it.

**K14 and K15 are the two ways of getting this same fix wrong.** K14 puts the
count back; K15 keeps it for every arity except the one the old witnesses used.

---

## 6. Full verification

```
suite       70 files / 3002 tests, all passing
typecheck   exit 0
monitor     621 programs / 27 constructs / no drift, in the WORKTREE ledger
            baseline accepted with a stated reason (STALE BASELINE, two new
            conformance gates registered for packages/interp/src/index.ts)
```

Instrument check on this finding's own path, per 0022 §5.1:

```
pnpm build:cli   exit 0
bundle vs source, same subcommand, same program
  exit      0 vs 0
  stdout    815 vs 815 bytes  IDENTICAL   (ts/mono/seq normalised)
  eml:equiv actual   "Slate() takes no arguments\n"
            expected "Slate() takes no arguments\n"
```

Both sides of `eml:equiv` compared directly, not the `ok` flag.

---

## 7. Isolation, measured rather than asserted

A marker was planted in the worktree's interpreter and both checkouts were run
on the same program:

```
worktree   "text":"WORKTREE MARKER REACHED"
product    "text":"Slate() takes no arguments (1 given)"
```

The product does not merely lack the marker — it still exhibits the original
defect, so neither the marker nor the fix leaked into it. Restoring the worktree
afterwards required rebuilding it from `patch-v3.diff` plus the one-line change;
the rebuilt file's sha256 is `63321fefe898ea7c`, byte-identical to the hash the
drill run recorded, so the tree measured above and the tree shipped here are the
same tree.

---

## Not done, and one thing to flag

Not touched: 006–022; the registry; the trace error-outcome contract; PR #3 and
PR #4. Nothing landed, released or deployed.

`scripts/semantic-monitor.mjs` registers `tests/user-function-arity.test.ts`
**twice**, at two different comment blocks, both from my earlier rounds of this
finding. I left it alone rather than fold an unrelated tidy-up into a candidate
that is meant to be minimal, but it should be removed by someone.

Stopping here for the next undisclosed V.
