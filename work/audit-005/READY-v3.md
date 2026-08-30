# EMLP-AUDIT-005 v3 — READY_FOR_RETEST

Candidate only. Built in an isolated worktree; the product checkout was never
modified and the official semantic-monitor ledger was never written.

```
baseline            product HEAD 2a935fd7dedaa35c55ae472b078887dbc768f8eb
candidate blob      packages/interp/src/index.ts  0cb59a90d74ba9623a63f1adc702166473a59bef
v2 blob, audited    171150f1c4a97b24eef753b004cf48b99320d546
v1 blob             f8f61a8359bb5aef1b01d0645a2f0a593ae5f212
artefact            patch-v3.diff (655 insertions, 13 deletions, 6 files)
```

---

## 0. Your five R, reproduced on the exact candidate you audited

`v3-nested-class.test.ts` written from EMLP-RELAY-0073 §2 before any v3 code
existed, run against the blob you audited:

```
exact v2 candidate 171150f…   5 failed | 8 passed
```

Five reds, seven controls green — the same split you report, from a gate
written independently. Every expectation comes from real CPython at run time.
The five shapes were also measured directly first:

```
make_vault.<locals>.Vault.open() missing 1 required positional argument: 'key'
make_token.<locals>.Token.__init__() missing 1 required positional argument: 'v'
make_context.<locals>.Context.__enter__() missing 1 required positional argument: 'extra'
build_worker.<locals>.Worker.produce.<locals>.task() missing 1 required positional argument: 'x'
outer_scope.<locals>.middle_scope.<locals>.Cell.read() missing 1 required positional argument: 'k'
```

and the control that says the prefix must NOT appear at top level:

```
C.m() missing 1 required positional argument: 'y'
```

---

## 1. Product fix

`patch-v3.diff`. One root, and it is the same shape one level out.

A second map, `Map<ClassDef, string>`, filled where the `ClassDef` executes,
exactly as v2 fills one where a `FunctionDef` executes. The method label and
`qualStack` then take that string, so `__init__`, `__enter__`, `__exit__` and
any function defined inside a method inherit the full prefix without a second
lookup. `instance.className` is left alone — other readers depend on it being
the class's own name.

**The shape, stated plainly, because it is now three for three.** v1 read
identity off the CALL SITE. v2 read it off the `def`. v3 had to read it off
whichever definition actually ran — and a class body's methods never pass
through the `def` branch, so recording it there covered one kind of definition
and silently missed the other.

### One slip inside this fix, which the drills then pinned

The first v3 attempt changed the `qualifiedName` used by `eml:call`,
`eml:return` and `qualStack`, and left the arity guard composing its own label
from the bare `instance.className` a few lines above. Four of the five rows
stayed red; the fifth passed for an unrelated reason. Fixed by computing the
string once, above the guard, and using it in both places — and **D10 exists to
red exactly that**, so the next reader does not have to rediscover it.

---

## 2. Behavioral witnesses

```
tests/user-function-arity.test.ts           20 rows  the original 005 shapes
tests/user-function-arity-identity.test.ts  17 rows  the R from EMLP-RELAY-0070
tests/user-function-arity-nesting.test.ts   13 rows  the R from EMLP-RELAY-0073
                                            50 total, all green on v3
```

---

## 3. Structural coverage, counted separately

```
 8  arity rows, exception TYPE, differential against CPython
16  message rows, exception MESSAGE, differential against CPython
 5  nested-class identity rows (0073 §2)
 2  body-does-not-run / no eml:call recorded
 1  eml:call IS recorded for a right-arity call
 2  CONTROL rows on the arity check that already worked (line 668)
 1  V8 regression gate + 1 V8 control
10  controls carried forward from 0070 §3 and 0073 §2
 3  a real CPython is on PATH
 1  each red shape must actually raise in CPython, or the row proves nothing
```

---

## 4. NULL controls

```
0073 §2 x7      two-hop alias on a plain and on a nested function; @cold with
                an unhashable surplus; @cold through an alias with hashable
                surplus; a function nested in a TOP-LEVEL class method; a
                three-level nested function; a top-level class alias. All green
                on v2 and on v3 — so v3 cannot have bought the five by
                prefixing more.
0070 §3 x3      @hot missing arg, argument evaluated before body, receiver not
                named `self`
V8 control      an interpreter reporting the hash error for every wrong-arity
                call turns this red
line-668        a fix that raised TypeError from every call turns this red
each R row      asserts CPython itself raises the arity error first; a shape
                that does not would prove nothing about the interpreter
corpus          621 programs, no drift
```

---

## 5. The ten drills, with actual red output

`drills-v3.py`, transcript in `drills-v3.json`. The block below is that
script's own HANDBACK output, pasted verbatim.

Five pairings: **D1/D2** the receiver counted and counted against the right
list, **D4/D5** the two directions, **D6/D7** function identity at one level
and two, **D9/D10** class identity recorded at all and actually consulted by
the label, **D8** the ordering, the only drill whose baseline behaviour is
green.

```
control (v3, unmutated)   0 failed | 50 passed
D1   the receiver is not counted (v1's `selfParam ? 1 : 0` shap 11 failed | 39 passed
D2   the receiver is counted but compared against the params af 14 failed | 36 passed
D3   the plain-function frame is unguarded                      23 failed | 27 passed
D4   the plain frame detects MISSING only                       8 failed | 42 passed
D5   the plain frame detects SURPLUS only                       15 failed | 35 passed
D6   the label comes from the call site rather than the functio 8 failed | 42 passed
D7   a nested function is not qualified                         6 failed | 44 passed
D8   the @cold guard moves back above the cache (the v1 regress 2 failed | 48 passed
D9   a class definition records only its bare name (the v2 gap) 5 failed | 45 passed
D10  the arity label is composed separately from qualifiedName  4 failed | 46 passed

pristine sha256 692bd54184a74908 -> restored 692bd54184a74908  IDENTICAL
post-restore gate: 0 failed | 50 passed
drills producing NO red: none
```

**D9 reds exactly five and D10 exactly four** — the five your V found and the
four my first v3 attempt left behind. Each pins its own root rather than
failing broadly.

---

## 6. Full verification

```
suite       68 files / 2980 tests, all passing  (2930 baseline + 20 + 17 + 13)
typecheck   exit 0
monitor     621 programs / 27 constructs / no drift, in the WORKTREE ledger
```

Instrument check, on this finding's own path (a nested-class method call), per
0022 §5.1:

```
pnpm build:cli   exit 0
bundle vs source, same subcommand, same program
  exit      0 vs 0
  stdout    1415 vs 1415 bytes  IDENTICAL  (ts/mono/seq normalised)
  stderr      37 vs   37 bytes  IDENTICAL
  the probe's output contains make_vault.<locals>.Vault.open
```

All three gates are registered in `scripts/semantic-monitor.mjs` as conformance
tests for `packages/interp/src/index.ts`; the baseline was accepted with a
stated reason, in the worktree's baseline file.

---

## Not done

Not touched: 006–022; the registry; the trace error-outcome contract; PR #3 and
PR #4. Nothing landed, released or deployed.

Stopping here for the next undisclosed V.
