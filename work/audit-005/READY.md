# EMLP-AUDIT-005 — READY_FOR_RETEST

Candidate only. Nothing landed: the product working tree was restored to
`5595b93` after these measurements, and `patch.diff` is the artifact.

Baseline: product HEAD `5595b93f91ebe3f2b8d2f1540510ad38c25a536b`, the commit
EMLP-RELAY-0067 names.

---

## 1. Product fix

`patch.diff` — 74 insertions, 2 deletions across two files.

`packages/interp/src/index.ts`

- new `arityError(label, params, argc, boundSelf)`, returning CPython's
  positional-arity `TypeError` or `undefined`;
- called at **both** parameter-binding sites, above the `@cold` cache lookup,
  above `eml:call`, and above the depth counter.

`scripts/semantic-monitor.mjs` — registers the new gate as a conformance test
for `packages/interp/src/index.ts`, and the baseline was accepted with a stated
reason so this file's drift check can fail in future rather than being excused
by the gate's own absence.

### Scope — the finding names one line; there are two

The report is `packages/interp/src/index.ts:620`. A read-only census (run, not
inferred — `census/census005.json`) found a second site with the identical
`args[i] ?? NONE` shape, serving six callers:

```
620  fn.params.forEach(...)         plain def, including @cold/@hot
705  restParams.forEach(...)        runMethodBody, reached from
     666   __init__ via instantiateClass
     680   callMethod  ->  instance.m(args)
     1013  __enter__
     1017 / 1028 / 1036  __exit__
```

A fix at 620 alone leaves 5 of the 8 census cells red. The whole interpreter
contained exactly two arity checks before this: line 668 (a class with **no**
`__init__` — the CONTROL below) and line 1294, which belongs to the builtin
argument accessor, not to user functions.

No language change: `params` is parsed as `Identifier[]` with no defaults, no
`*args`, no `**kwargs`, so an exact length comparison cannot refuse a legal
call shape. Per the scope rule settled 2026-08-12, nothing here narrows the
language.

---

## 2. Behavioral witnesses

Canonical R from HANDOFF, on `5595b93`:

```
before   interp 'None\n1\n'        cpython 'MISSING\nEXTRA\n'   equiv ok:false   CLI exit 1
after    interp 'MISSING\nEXTRA\n' cpython 'MISSING\nEXTRA\n'   equiv ok:true    CLI exit 0
```

Census, every cell run against real CPython (`census/census005.json`):

```
cell                    site           before-fix   interp / cpython
A-plain-missing         620            DIVERGE      'None\n'   / 'TypeError\n'
B-plain-extra           620            DIVERGE      '1\n'      / 'TypeError\n'
C-cold-extra            620            DIVERGE      '1\n'      / 'TypeError\n'
D-method-missing        705            DIVERGE      'None\n'   / 'TypeError\n'
E-method-extra          705            DIVERGE      '1\n'      / 'TypeError\n'
F-init-missing          705 via 666    DIVERGE      'None\n'   / 'TypeError\n'
G-init-extra            705 via 666    DIVERGE      '1\n'      / 'TypeError\n'
H-exit-arity            705 via 1017   DIVERGE      'IN\n'     / 'IN\nTypeError\n'
CONTROL-noinit-extra    668            AGREE        'TypeError\n' / 'TypeError\n'
```

The failure mode worth recording is that none of these raised: a missing
argument became `None` and a surplus one vanished, so every call **succeeded**
with a plausible wrong value.

---

## 3. Structural coverage

`tests/user-function-arity.test.ts`, 20 rows, counted separately:

```
 8  arity rows, exception TYPE, differential against real CPython
 7  message rows, exception MESSAGE, differential against real CPython
 1  body-does-not-run row
 1  no eml:call recorded for a wrong-arity call
 1  eml:call IS recorded for a right-arity call   (NULL control for the row above)
 1  CONTROL row on the arity check that already worked (line 668)
 1  a real CPython is on PATH
```

The message rows exist because the type rows cannot see the message, and the
message is where a method's counts live. Five details were measured against
CPython 3.14 rather than recalled: the count and the noun pluralise
independently; two names join with `and`, three or more take an Oxford comma; a
method is `Class.method`; and a method's counts include the bound `self`.

---

## 4. NULL controls

```
CONTROL row (line 668)          a fix that raised TypeError from every call
                                would turn this row red. It is green.
right-arity call records a call an assertion that no eml:call is ever recorded
                                would pass against an interpreter that records
                                nothing at all. This row fails if it does.
census CONTROL cell             AGREE — the census probe can tell a working
                                arity check from a missing one, so its 8 reds
                                are findings and not a probe that reports red
                                everywhere.
corpus                          606 programs, no drift: not one corpus program
                                ever made a wrong-arity call, so nothing in the
                                corpus is silently relying on the old behaviour.
```

---

## 5. The seven drills, with actual red output

`drill-harness.py`, full transcript in `drills.json`. Pristine sha256
`d7df9a8cd1186ccc`, restored sha256 `d7df9a8cd1186ccc`, IDENTICAL; post-restore
gate 0 failed / 20 passed.

Three pairings, for the reason 003 paired 2/3 and 6/7: **D1/D2** the two binding
sites are guarded separately, **D3/D4** the two directions are checked
separately, **D6/D7** "too late for the record" and "too late for the body" are
different failures.

```
Control — patched, unmutated
   Tests  20 passed   red=0    mechanism fired 8/8 probes

D1  620 unguarded
   Tests  10 failed | 10 passed          mechanism 4/8
     x plain def, one arg missing [620]      x plain def, one arg surplus [620]
     x plain def, two of three missing [620] x @cold def, one arg surplus [620]
     x body must not run     x records no call for a wrong-arity call
     x message: plain missing / plain surplus / Oxford comma / two names and

D2  705 unguarded
   Tests  4 failed | 16 passed           mechanism 4/8
     x method, one arg missing [705]     x method, one arg surplus [705]
     x __init__, one arg missing         x __init__, two args surplus
     x message: method counts the bound self / method missing is qualified

D3  620 detects MISSING only
   Tests  5 failed | 15 passed           mechanism 6/8
     x plain def, one arg surplus  x @cold def, one arg surplus
     x body must not run           x records no call
     x message: plain surplus

D4  620 detects SURPLUS only
   Tests  5 failed | 15 passed           mechanism 6/8
     x plain def, one arg missing  x plain def, two of three missing
     x message: plain missing / Oxford comma / two names and

D5  705 stops counting the bound self
   Tests  2 failed | 18 passed           mechanism 8/8
     x message: method counts the bound self
     x message: __init__ is qualified and counts self

D6  620 guard below eml:call
   Tests  1 failed | 19 passed           mechanism 8/8
     x records no call for a wrong-arity call, because none happened

D7  620 guard below the body
   Tests  10 failed | 10 passed          mechanism 4/8
     (as D1 — with a `return` in the body the relocated guard is unreachable)

drills that produced NO red: none
reduce guard reachability (5/7): D1 4/8, D2 4/8, D3 6/8, D4 6/8, D7 4/8
keep full reachability, break what it REPORTS: D5 8/8, D6 8/8
```

Two of these were found by the drills rather than by me, and both are recorded
because they were real gaps:

- **D5 was green** until the message rows existed. The gate compared only the
  exception type, which is the bar `tests/builtin-shapes.test.ts` sets, and that
  bar cannot see a method reporting 1-and-2 for a call CPython describes as
  2-and-3. All of the CPython message work was ungated.
- **The mechanism counter read 0/8 everywhere, including the control.** It wrote
  its probe into the board directory, where `@eml/interp` does not resolve; tsx
  exited `ERR_MODULE_NOT_FOUND`, stdout was empty, and the count reported the
  same 0 a guard that never fires would. It now writes into the product tree,
  raises on a non-zero exit, and refuses to report at all unless the control
  fires 8/8.

---

## 6. Full verification

```
suite         66 files / 2905 tests, all passing
typecheck     exit 0
monitor       606 programs / 27 constructs / no drift
canonical R   equiv ok:true, CLI exit 0
```

Instrument check, per PROTOCOL and sharpened by EMLP-RELAY-0022 §5.1 — the probe
traverses **this finding's** path (a wrong-arity call), not an arbitrary smoke
program:

```
pnpm build:cli            exit 0
bundle vs source, same subcommand on the same wrong-arity program
  exit code   0  vs  0    same
  stdout    654 vs 654 bytes   IDENTICAL  (ts/mono/seq normalised)
  stderr     36 vs  36 bytes   IDENTICAL
```

---

## Not done, deliberately

Not touched: 006–022; the semantic-role / gate registry; the trace error-outcome
contract; PR #3. Not landed in the product, not released, not deployed — per
EMLP-RELAY-0067 that remains Neo's separate authorisation.

Stopping here for the undisclosed V.
