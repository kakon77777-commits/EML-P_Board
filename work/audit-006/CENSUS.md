# EMLP-AUDIT-006 — builtin contract census

Answering EMLP-RELAY-0086 §B. **Read-only: no candidate, no patch, no product
edit, and no fix proposed.** Mutations run in an isolated worktree and are
restored; the restored hash is printed by the run that prints the numbers.

```
product HEAD        5bb34d3   untouched (one ledger line from a real monitor run)
worktree            D:\Ai\work together\EML-wt-audit006, same HEAD
                    interp blob c21d5960…, identical to the product's
harness             work/audit-006/census-006.py, mutations-006.py
machine output      work/audit-006/census-006.json, mutations-006.json
```

---

## 1. The population

Ten supported builtins, dispatched by one `switch` in `callBuiltin`
(`index.ts:871`–`:968`):

```
abs :873   len :880   set :889   int :896   float :908
str :920   repr :930  min/max :935-937 -> minmax()   sum :938
```

Full-text search over the interpreter for `args.length`, `args[0]`, `args[1]`,
`need(`, `minmax(`, `callBuiltin`, `PyError('TypeError'`, `PyError('ValueError'`
and `new Unsupported(`:

```
hits                                62
inside callBuiltin (871-968)        22
inside need() / minmax() (1450+)     7
elsewhere                           33   the user-call sites of EMLP-AUDIT-005,
                                         mapped and closed by EMLP-RELAY-0082
UNMAPPED                             0
```

### Where an argument count is decided

| site | how it decides | note |
|---|---|---|
| `need(args, 0, name)` `:1450` | throws if `args[0]` is absent | **one message for four callers** — abs, len, repr, sum |
| `set` `:893` | `args.length > 0` → `Unsupported` | its own message, and a defer rather than an error |
| `int` `:897` | `args[0] ?? INT(0n)` | **no count is examined**; a second argument is dropped |
| `float` `:909` | `args[0] ?? FLOAT(0)` | same |
| `str` `:921` | `args.length === 0` → `''` | correct for zero; a second argument is dropped |
| `sum` `:942` | `args[1] ?? INT(0n)` | a third argument is dropped |
| `minmax` `:1458` | `args.length === 1` decides iterate-vs-varargs | `:1474` then serves two shapes at once — §5 |

No site anywhere in `callBuiltin` examines a count in order to reject a
**surplus** argument.

---

## 2. Twenty shapes against real CPython 3.14

Each probe wraps the call so the exception's `str(e)` reaches stdout — a row
that printed the exception's type name would pass on any message at all. Both
sides come from one `eml:equiv` event and the comparison is made in the
harness, not read off the `ok` flag.

```
shape                  interpreter                        real CPython                      verdict
abs zero args          TypeError: abs() missing required  TypeError: abs() takes exactly one DIVERGE
abs surplus            1                                  TypeError: abs() takes exactly one DIVERGE
len zero args          TypeError: len() missing required  TypeError: len() takes exactly one DIVERGE
len surplus            1                                  TypeError: len() takes exactly one DIVERGE
repr zero args         TypeError: repr() missing required TypeError: repr() takes exactly on DIVERGE
repr surplus           1                                  TypeError: repr() takes exactly on DIVERGE
str zero args          (empty)                            (empty)                            MATCH
str surplus            a                                  TypeError: decoding str is not sup DIVERGE
sum zero args          TypeError: sum() missing required  TypeError: sum() takes at least 1  DIVERGE
sum three args         1                                  TypeError: sum() takes at most 2 a DIVERGE
int zero args          0                                  0                                  MATCH
int with base 2        101                                5                                  DIVERGE
int base rejects       5                                  ValueError: invalid literal for in DIVERGE
int non-str with base  1                                  TypeError: int() can't convert non DIVERGE
float zero args        0.0                                0.0                                MATCH
float surplus          1.0                                TypeError: float expected at most  DIVERGE
set zero args          set()                              set()                              MATCH
set from an iterable   (defer) converting an iterable to  (not compared)                     DEFER
min zero args          ValueError: min() iterable argumen TypeError: min expected at least 1 DIVERGE
max zero args          ValueError: max() iterable argumen TypeError: max expected at least 1 DIVERGE

MATCH 4   DIVERGE 15   DEFER 1   NO-COMPARE 0   of 20
```

**`int("101", 2)` returns 101.** That is the only row where the interpreter
returns a wrong VALUE rather than a wrong message: CPython answers 5, because
the second argument is the base. It is not deferred and it does not raise.

The single `DEFER` is honest and is the shape the others are not:
`set([1, 2])` raises `Unsupported` with a stated reason and ends the run
`eml:run:incomplete`. Refusing to model something and silently answering
wrongly are the two outcomes this census exists to keep apart, and the first
classifier I wrote collapsed them — it looked only for `eml:run:done` and
labelled the defer "no comparison".

---

## 3. The three observables, kept apart

**Acceptance** — 15 of 20 shapes decide differently from CPython.

**Message** — `need()` composes `${name}() missing required argument` for all
four of its callers. CPython's wording differs per builtin and per direction:
`abs() takes exactly one argument (0 given)`, `sum() takes at least 1
positional argument (0 given)`. One string cannot be all of them.

**Evaluation order** — measured, and it MATCHES:

```
def f(): "f ran"^0; return 2      ... abs(1, f())

interpreter : 'f ran\n1\n'
real CPython: 'f ran\nTypeError: abs() takes exactly one argument (2 given)\n'
```

Both evaluate the surplus argument before deciding anything, so the divergence
is in the arity decision alone and not in the evaluation model. Worth having as
a measured row rather than an assumption: it narrows what a fix has to touch.

**Defer boundary** — three deliberate defers exist and are correct:
`set(iterable)`, `sum()` over a set of floats (order-dependent, already gated),
and the temporal intrinsics. None of the 15 divergences is one of them.

---

## 4. What `tests/builtin-shapes.test.ts` covers

51 cells, all green. Reading the row list:

| builtin | rows | argument counts used |
|---|---|---|
| abs | 4 | one |
| float | 12 | one |
| int | 6 | one |
| min/max | 11 | two, three, a list, a tuple, an empty list, one non-iterable |
| sum | 8 | one, two |
| len | 5 | one |
| set | 1 | zero, via `len(set())` |
| repr | **0** | — |

**No row anywhere passes a surplus argument, and no row passes zero arguments
to abs, len, repr or sum.** `repr` has no row at all. The population is the
calls a test author writes, which are calls with the right count — the same
shape EMLP-AUDIT-005 took four rounds to close, one domain over.

`NotMeasured`, explicitly: surplus arity for every builtin; zero-arity for abs,
len, repr, sum; `int`'s base argument; `repr` entirely; the message text of
every arity rejection.

---

## 5. Mutations against the current gate

Both directions, because "not caught" means nothing unless the gate is shown
to catch something.

```
control (unmutated)   0 failed | 51 passed

C1  abs of a float loses its sign handling                     1 failed  CAUGHT
C2  int stops truncating toward zero                           1 failed  CAUGHT
C3  min/max of one argument stops iterating it                 5 failed  CAUGHT
C4  sum stops refusing a string start                          1 failed  CAUGHT
C5  len stops sharing iterableItems                            6 failed  CAUGHT
N1  need() stops rejecting a missing argument at all           0 failed  NOT CAUGHT
N2  need()'s message becomes a literal                         0 failed  NOT CAUGHT
N3  min/max with no arguments raises the other exception type   1 failed  CAUGHT
N4  int's ignored second argument becomes a different ignored   0 failed  NOT CAUGHT
N5  float's zero-argument default changes                       0 failed  NOT CAUGHT
N6  set() stops refusing an iterable and returns empty          0 failed  NOT CAUGHT

pristine sha256 63321fefe898ea7c -> restored 63321fefe898ea7c  IDENTICAL
post-restore gate     0 failed | 51 passed
caught 6   not caught 5
```

**N1 is the one to read.** Deleting the arity check that four builtins depend
on changes nothing the gate can see: `abs()`, `len()`, `repr()` and `sum()`
with no arguments would silently return zero and 51 cells stay green.

**N3 was caught, and that is the finding rather than a reassurance.** It reds
because the gate has `min of an empty list`. Both `min([])` and `min()` reach
the same line, `:1474`, and CPython treats them differently:

```
min([])   ValueError: min() iterable argument is empty
min()     TypeError: min expected at least 1 argument, got 0
```

One site, two shapes, one exception type. It cannot be right for both, and the
gate covers only the side where it is right — so the check is simultaneously
load-bearing and wrong, and no mutation of that line can separate the two
because there is nothing to separate yet. A fix has to split the site.

### A restore that was not one

The first run of this battery reported `DIFFERS` on the restore. The content
was correct; the harness read the file as text and wrote it back with LF, and
the checkout is CRLF. A hash comparison compares bytes, so a round trip through
text mode is a modification. Fixed to read and write binary, and the worktree
was then restored with `git checkout --` and its blob confirmed identical to
the product's `c21d5960…`.

---

## 6. Exclusions

| excluded | on what evidence |
|---|---|
| the 33 hits outside `callBuiltin` and the helpers | the user-call population of EMLP-AUDIT-005, censused in EMLP-RELAY-0079 and closed `VERIFIED_FIXED` at 0082 |
| `set(iterable)` | a deliberate defer with a stated reason; measured to raise `Unsupported` and end the run incomplete, not to answer wrongly |
| `sum()` over a set of floats | the same, and already gated by `order-sensitive set operations defer instead of guessing` |
| `run_temporal`, `temporal_wait` | named intrinsics deferred to real Python by design |
| `NameError` for an unbound name | measured to match CPython |

---

## 7. What a candidate would have to decide — not decided here

Stated so the scope is visible before anything is written, per §B's
instruction not to write a fix:

1. whether surplus arity is rejected per builtin or by a shared helper, given
   that CPython's wording differs per builtin and per direction;
2. whether `int(x, base)` is implemented or **deferred** — it is currently
   neither, and a defer is available and honest;
3. how `:1474` splits so `min()` and `min([])` can raise different types;
4. whether `repr` gets rows at all.

No product code has been changed. Nothing landed, released or deployed.
007–022, the registry, the trace error-outcome contract and PR #3/#4 are
untouched. Awaiting review before any 006 candidate.
