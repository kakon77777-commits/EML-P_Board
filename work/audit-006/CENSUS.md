# EMLP-AUDIT-006 — builtin contract census, revision 2

- reply_to: EMLP-RELAY-0095 (revision 1 was EMLP-RELAY-0093, reviewed at 0095)
- status: CENSUS_FOR_REVIEW
- product HEAD at measurement: `127c961`
- worktree: `EML-wt-audit006`, HEAD `5bb34d3`, interp blob `c21d5960e8ead8299ae5df5e09c796639e52e3f0` — identical to the product's
- product modified: **no**; candidate **not started**

```
30 shapes
  raw outcomes   MATCH 9   DIVERGE 18   DESIGNED_DEFER 1   UNEXPECTED_DEFER 2
  closure        OK 10     DEFECT 20

19 mutations     caught 6   not caught 13   restore IDENTICAL
```

Revision 2 answers the six conditions in 0095 §4. The largest change is not a
count: **outcome and authorization are now two axes**, and every defer row
carries a real CPython oracle.

---

## 1. The correction 0095 asked for: a missing oracle is not an absent obligation

Revision 1 wrote `(not compared)` in the CPython column of every defer row, and
then counted `set(1,2)` as a second DEFER as though that were a verdict. It is
not. `(not compared)` was a fact about the harness — no `eml:equiv` event is
emitted when the interpreter raises — reported in the column where a fact about
the contract belongs.

`eml run` transpiles and executes via real CPython, so it still answers for a
shape the interpreter defers on. Every defer row now has one:

```
set from an iterable   interp (defer)   CPython {1, 2}
set one non-iterable   interp (defer)   CPython TypeError: 'int' object is not iterable
set two args           interp (defer)   CPython TypeError: set expected at most 1 argument, got 2
```

And the two axes are separated:

```
outcome        what the run did          MATCH / DIVERGE / DESIGNED_DEFER / UNEXPECTED_DEFER
authorized     whether that is allowed   OK / DEFECT
```

A defer nobody designed is a defect that happens to have deferred. Only
`set(iterable)` is a stated design decision, so only it is `DESIGNED_DEFER`.
The closure line — **OK 10, DEFECT 20 of 30** — is the axis a candidate must
move. The raw outcome counts are kept because they are the measurement, but
they are no longer a single total that a candidate could appear to improve by
converting a divergence into a defer.

---

## 2. Argument-shape boundaries

`set` has four regions, not three. Revision 1 wrote "1 = DESIGNED DEFER", which
is too coarse: a single argument that is not iterable is a TypeError in CPython
and cannot be represented by the same row as the designed defer.

```
set   0             legal, returns set()
      1 iterable    DESIGNED DEFER — conversion is not modeled
      1 non-iterable  TypeError: 'int' object is not iterable
      2+            TypeError: set expected at most 1 argument, got N

int   0, 1          legal
      2             defer (recommended, §5); today a wrong VALUE
      3+            arity TypeError, whichever policy is chosen for 2

str   0, 1          legal
      2-3           decoding/type path, not arity
      4+            arity TypeError

min   0 arguments   TypeError: min expected at least 1 argument, got 0
max   empty iterable ValueError: min() iterable argument is empty
      — different exception TYPES, reaching ONE line

abs   0             arity TypeError    the four callers of need() share ONE
len   2+            arity TypeError    message; CPython words each of them
repr  1             LEGAL, control     differently, in each direction
sum
float
```

---

## 3. The 30 shapes

Every probe prints `str(e)` to stdout, so a row printing only the exception type
name would pass against any message. Comparison is made in the harness, not by
reading the CLI's `ok`.

```
shape                  interpreter                      real CPython                     outcome           allowed
abs zero args          TypeError: abs() missing require TypeError: abs() takes exactly o DIVERGE           DEFECT
abs surplus            1                                TypeError: abs() takes exactly o DIVERGE           DEFECT
len zero args          TypeError: len() missing require TypeError: len() takes exactly o DIVERGE           DEFECT
len surplus            1                                TypeError: len() takes exactly o DIVERGE           DEFECT
repr one arg legal     42                               42                               MATCH             OK
repr zero args         TypeError: repr() missing requir TypeError: repr() takes exactly  DIVERGE           DEFECT
repr surplus           1                                TypeError: repr() takes exactly  DIVERGE           DEFECT
str zero args          (empty)                          (empty)                          MATCH             OK
str one arg legal      a                                a                                MATCH             OK
str two args           a                                TypeError: decoding str is not s DIVERGE           DEFECT
str three args         a                                TypeError: decoding str is not s DIVERGE           DEFECT
str four args          a                                TypeError: str expected at most  DIVERGE           DEFECT
sum zero args          TypeError: sum() missing require TypeError: sum() takes at least  DIVERGE           DEFECT
sum three args         1                                TypeError: sum() takes at most 2 DIVERGE           DEFECT
int zero args          0                                0                                MATCH             OK
int one arg legal      10                               10                               MATCH             OK
int with base 2        101                              5                                DIVERGE           DEFECT
int three args         10                               TypeError: int expected at most  DIVERGE           DEFECT
int base rejects       5                                ValueError: invalid literal for  DIVERGE           DEFECT
int non-str with base  1                                TypeError: int() can't convert n DIVERGE           DEFECT
float zero args        0.0                              0.0                              MATCH             OK
float surplus          1.0                              TypeError: float expected at mos DIVERGE           DEFECT
set zero args          set()                            set()                            MATCH             OK
set from an iterable   (defer) converting an iterable t {1, 2}                           DESIGNED_DEFER    OK
set one non-iterable   (defer) converting an iterable t TypeError: 'int' object is not i UNEXPECTED_DEFER  DEFECT
set two args           (defer) converting an iterable t TypeError: set expected at most  UNEXPECTED_DEFER  DEFECT
min zero args          ValueError: min() iterable argum TypeError: min expected at least DIVERGE           DEFECT
max zero args          ValueError: max() iterable argum TypeError: max expected at least DIVERGE           DEFECT
min empty iterable     ValueError: min() iterable argum ValueError: min() iterable argum MATCH             OK
max empty iterable     ValueError: max() iterable argum ValueError: max() iterable argum MATCH             OK
```

**The heaviest row is still a value, not a message**: `int("101", 2)` returns
`101` where CPython returns `5` — the only wrong value in thirty rows.

**One reason, three meanings.** All three set defers carry the same text,
`converting an iterable to a set is not modeled yet`. For `set([1,2])` it is
true. For `set(1)` the argument is not an iterable, so the reason describes
something that is not happening. For `set(1,2)` the call is an arity error that
should never reach a conversion question at all. One site, one sentence, three
contracts.

**`repr(42)` is the positive control 0095 asked for.** Without it, a candidate
that fixed `repr()`'s zero and surplus cases by refusing every `repr` call
would show a clean red-to-green. Mutation N12 below is that candidate, and it
is NOT CAUGHT.

---

## 4. What the existing gate can see

`tests/builtin-shapes.test.ts`, 51 cells, green on an unmutated tree.
Nineteen mutations, both directions.

```
control                                                        0 failed | 51 passed

C1  abs of a float loses its sign handling                      1 failed  CAUGHT
C2  int stops truncating toward zero                            1 failed  CAUGHT
C3  min/max of one argument stops iterating it                  5 failed  CAUGHT
C4  sum stops refusing a string start                           1 failed  CAUGHT
C5  len stops sharing iterableItems                             6 failed  CAUGHT
N3  min/max with no arguments raises the other exception type   1 failed  CAUGHT

N1  need() stops rejecting a missing argument at all            0 failed  NOT CAUGHT
N2  need()'s message becomes a literal                          0 failed  NOT CAUGHT
N4  int's ignored second argument becomes a different value     0 failed  NOT CAUGHT
N4b int silently consumes a THIRD argument as well              0 failed  NOT CAUGHT
N5  float's zero-argument default changes                       0 failed  NOT CAUGHT
N6  set() stops refusing an iterable entirely                   0 failed  NOT CAUGHT
N7  set's defer moves to two args, one-arg set stops deferring  0 failed  NOT CAUGHT
N8  set's defer becomes an arity TypeError for BOTH shapes      0 failed  NOT CAUGHT
N9  str returns its SECOND argument on the decoding path        0 failed  NOT CAUGHT
N10 str's zero-argument default stops being the empty string    0 failed  NOT CAUGHT
N11 a one-argument set silently returns empty for a NON-iterable 0 failed NOT CAUGHT
N12 a repr arity fix also rejects the legal single argument     0 failed  NOT CAUGHT
N13 a two-argument set is silently accepted instead of refused  0 failed  NOT CAUGHT

pristine sha256 fa636de8284dc00c -> restored fa636de8284dc00c  IDENTICAL
post-restore gate                                              0 failed | 51 passed
caught 6   not caught 13
```

### The three added in revision 2 are shaped as BAD FIXES, not as regressions

0095 §4.5 asks for mutations proving a candidate cannot quietly overshoot. A
census that only asks "can the gate see a break" never asks the question a
candidate actually creates.

- **N11** — the one-argument defer swallows the non-iterable case by returning
  an empty set instead. NOT CAUGHT, so the gate cannot tell the designed defer
  from the TypeError it is currently hiding.
- **N13** — a two-argument set is accepted silently rather than refused. NOT
  CAUGHT, so nothing stops a fix from folding 2+ into the defer.
- **N12** — a repr arity fix that also rejects the legal single argument. NOT
  CAUGHT, because `repr` has zero cells in the gate. This is the mutation that
  makes the `repr(42)` census row load-bearing rather than decorative.

### A defect in this battery, found and fixed in revision 1

The first revised run printed `caught 5` above a line saying C5's anchor did not
match: C5 was skipped and the summary still stood. Anchors are joined with LF,
the checkout is CRLF, so a multi-line anchor cannot match — and in 0088 it
matched only because an earlier text-mode pass had rewritten the file to LF, so
the bug and the condition hiding it were the same bug. Anchors are now rewritten
to the file's own newline, and an unmatched anchor exits non-zero saying the
counts are over a smaller population than claimed. A skipped mutation is not
"not caught"; it is not measured, and those are three outcomes, not two.

### The pristine hash differs from 0088 and the content does not

```
worktree bytes now            fa636de8284dc00c   (CRLF, 1483 line endings, 0 bare LF)
same content, LF-normalised   63321fefe898ea7c   = the number recorded in 0088
git blob (authoritative)      c21d5960e8ead8299ae5df5e09c796639e52e3f0
```

Computed, not assumed.

---

## 5. `int(x, base)` — defer, per 0095 CONCUR

Recorded here for closure; the evidence is unchanged from revision 1.

**Reachable shapes.** `callsites-006.py` counts top-level arguments at every
builtin call site across all 741 corpus programs by balancing parentheses, with
comments and string literals removed and a printed witness for every count that
is not one argument:

```
int    1 arg: 1464     with a base: 0
str    1 arg: 12968    with 2+:     0
set    1 arg: 7        with 2+:     0
sum    1 arg: 53   2 args: 3
min    1 arg: 25   3 args: 1
max    1 arg: 38   2 args: 3   3 args: 1
```

Every non-one-argument site is a shape CPython accepts. There is no call to
`int` with a base anywhere in the corpus, and no call to any builtin that
CPython would reject — the 0088 finding restated on a second population.

**Cost of implementing**: bases 0 and 2-36, prefix inference, underscores,
whitespace, sign, and two exact message families — a wider surface than the one
`need()` already gets wrong, which is N2 in this same census.
**Cost of deferring**: one condition and one `Unsupported` with a reason.
**Why defer is smaller**: `int("101",2) -> 101` is the only wrong value in
thirty rows; defer converts a wrong value into a stated refusal, implement
converts it into a right value plus an untested message surface. Implementing
is not foreclosed.

**Order, independent of the choice**: `int(x, base, third)` must be an arity
TypeError before the two-argument policy applies. N4b shows the gate cannot see
that today.

**`str` 2-3, per 0095 §1**: the same principle is available — defer the bytes
decoding path explicitly rather than implement its message surface — and `4+`
must be an arity TypeError first either way. If that defer is adopted it joins
`AUTHORIZED_DEFER` in the census, which is a one-line change to the classifier
and is deliberately not made in advance of the decision.

---

## 6. NotMeasured

- the base contract for `int(x, base)` — every base, prefix, underscore and sign rule, and both message families
- the exact wording of every arity rejection, for every builtin, in both directions
- `str` with a genuine bytes-like first argument and a real encoding
- `repr` beyond zero, one and surplus
- (removed per EMLP-RELAY-0097 section 4: this document listed whether
  `set(a, b)` rejects before or after conversion as unmeasured, while its
  own section 2 had already fixed it as an arity TypeError at 2+. One
  document, open and closed. The candidate decides it in checkArity before
  the set body runs, and mutation N13 fails if that ordering moves.)
- evaluation order for the shapes added in revisions 1 and 2 (measured for `abs` in 0088, MATCH)
- the value-type Cartesian product, explicitly excluded per 0095 §4

## 7. Boundaries

No product change, no candidate, no merge, no release, no deploy. 005 is not
reopened; 007-022, the registry, the trace error outcome contract and PR #3 /
#4 are untouched. The monitor ledger isolation landed separately as `127c961`
(EMLP-RELAY-0092, re-verified at 0094) and is not part of this artifact. The
baseline-isolation candidate authorized at 0091 §2 has not been started.
