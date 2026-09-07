# EMLP-AUDIT-006 — revised builtin contract census

- reply_to: EMLP-RELAY-0090, EMLP-RELAY-0091 (§3)
- status: CENSUS_FOR_REVIEW (revised)
- product HEAD at measurement: `127c961`
- worktree: `EML-wt-audit006`, HEAD `5bb34d3`, interp blob `c21d5960e8ead8299ae5df5e09c796639e52e3f0` — identical to the product's
- product modified: **no**
- candidate: **not started**, per 0091 §3

```
28 shapes    MATCH 8   DIVERGE 18   DEFER 2   NO-COMPARE 0
16 mutations caught 6   not caught 10   restore IDENTICAL
```

0090 predicted a revised minimum of 24 shapes at MATCH 4 / DIVERGE 19 / DEFER 1.
The measured revision is 28 / 8 / 18 / 2. The three differences are findings,
not bookkeeping, and each is below.

---

## 1. What 0088 got wrong

**`str("a","b")` is not a surplus-argument case, and I filed it as one.**
CPython's `str` takes up to three positional arguments, so two and three
arguments are a decoding/type path and true arity surplus begins at four. The
divergence I reported is real — the interpreter returns `"a"` where CPython
raises — but the reason I attached to it was wrong, and that wrong reason
happened to support my headline ("no builtin rejects surplus arguments"), so I
did not look again. It is the same shape this audit is about: a cell sorted
into a category it does not belong to, agreeing with the conclusion, therefore
not re-read.

Measured on real CPython 3.14.5:

```
str("a","b")          TypeError: decoding str is not supported
str("a","b","c")      TypeError: decoding str is not supported
str("a","b","c","d")  TypeError: str expected at most 3 arguments, got 4
```

**`set(1,2)` is not a divergence — it is a second defer**, which is the sharper
version of your point. One site (`args.length > 0`) serves two contracts, so
the interpreter answers both with the same `Unsupported`. It cannot distinguish
them, and the census now shows that as two DEFER rows rather than one.

---

## 2. The argument-shape boundaries

Each builtin's argument count is divided into regions with different contracts.
0088 had one region per builtin, which is why three boundaries were invisible.

```
set   0        legal, returns set()
      1        DESIGNED DEFER, converting an iterable is not modeled
      2+       arity TypeError, before any conversion is attempted

int   0, 1     legal
      2        implement-or-defer policy decision (§5)
      3+       arity TypeError, whichever policy is chosen for 2

str   0, 1     legal
      2-3      decoding/type path, not arity
      4+       arity TypeError

min   0        arity TypeError          min expected at least 1 argument, got 0
max   ()       ValueError               min() iterable argument is empty
      an empty iterable and no argument are DIFFERENT, and reach ONE line

abs   0        arity TypeError          the four callers of need() share ONE
len   2+       arity TypeError          message; CPython words each of them
repr                                    differently, in each direction
sum
float
```

---

## 3. The 28 shapes

Every probe prints `str(e)` to stdout, so a row that printed only the exception
type name would pass against any message. Both sides come from one `eml:equiv`
event and the comparison is made in the harness, not by reading the CLI's `ok`.

```
shape                  interpreter                          real CPython                          verdict
abs zero args          TypeError: abs() missing required    TypeError: abs() takes exactly one    DIVERGE
abs surplus            1                                    TypeError: abs() takes exactly one    DIVERGE
len zero args          TypeError: len() missing required    TypeError: len() takes exactly one    DIVERGE
len surplus            1                                    TypeError: len() takes exactly one    DIVERGE
repr zero args         TypeError: repr() missing required   TypeError: repr() takes exactly on    DIVERGE
repr surplus           1                                    TypeError: repr() takes exactly on    DIVERGE
str zero args          (empty)                              (empty)                               MATCH
str one arg legal      a                                    a                                     MATCH
str two args           a                                    TypeError: decoding str is not sup    DIVERGE
str three args         a                                    TypeError: decoding str is not sup    DIVERGE
str four args          a                                    TypeError: str expected at most 3     DIVERGE
sum zero args          TypeError: sum() missing required    TypeError: sum() takes at least 1     DIVERGE
sum three args         1                                    TypeError: sum() takes at most 2 a    DIVERGE
int zero args          0                                    0                                     MATCH
int one arg legal      10                                   10                                    MATCH
int with base 2        101                                  5                                     DIVERGE
int three args         10                                   TypeError: int expected at most 2     DIVERGE
int base rejects       5                                    ValueError: invalid literal for in    DIVERGE
int non-str with base  1                                    TypeError: int() can't convert non    DIVERGE
float zero args        0.0                                  0.0                                   MATCH
float surplus          1.0                                  TypeError: float expected at most     DIVERGE
set zero args          set()                                set()                                 MATCH
set from an iterable   (defer) converting an iterable to    (not compared)                        DEFER
set two args           (defer) converting an iterable to    (not compared)                        DEFER
min zero args          ValueError: min() iterable argumen   TypeError: min expected at least 1    DIVERGE
max zero args          ValueError: max() iterable argumen   TypeError: max expected at least 1    DIVERGE
min empty iterable     ValueError: min() iterable argumen   ValueError: min() iterable argumen    MATCH
max empty iterable     ValueError: max() iterable argumen   ValueError: max() iterable argumen    MATCH
```

**The heaviest row is still a value, not a message**: `int("101", 2)` returns
`101` where CPython returns `5`. It is the only wrong value in twenty-eight
rows. Everything else is an acceptance or a message.

**`min`/`max` now show both halves adjacently.** The empty-iterable rows MATCH
and the zero-argument rows DIVERGE, and both reach line `:1474`. One site
cannot be right about two shapes that CPython gives different exception types,
and the existing gate covers exactly the half that happens to be correct — so
that assertion is load-bearing and wrong at the same time.

---

## 4. What the existing gate can see

`tests/builtin-shapes.test.ts`, 51 cells, all green, on an unmutated tree.

Sixteen mutations, both directions, because "not caught" is meaningless without
"can be caught":

```
control                                                       0 failed | 51 passed

C1  abs of a float loses its sign handling                     1 failed  CAUGHT
C2  int stops truncating toward zero                           1 failed  CAUGHT
C3  min/max of one argument stops iterating it                 5 failed  CAUGHT
C4  sum stops refusing a string start                          1 failed  CAUGHT
C5  len stops sharing iterableItems                            6 failed  CAUGHT
N3  min/max with no arguments raises the other exception type  1 failed  CAUGHT

N1  need() stops rejecting a missing argument at all           0 failed  NOT CAUGHT
N2  need()'s message becomes a literal                         0 failed  NOT CAUGHT
N4  int's ignored second argument becomes a different value    0 failed  NOT CAUGHT
N4b int silently consumes a THIRD argument as well             0 failed  NOT CAUGHT
N5  float's zero-argument default changes                      0 failed  NOT CAUGHT
N6  set() stops refusing an iterable entirely                  0 failed  NOT CAUGHT
N7  set's defer moves to two args, one-arg set stops deferring 0 failed  NOT CAUGHT
N8  set's defer becomes an arity TypeError for BOTH shapes     0 failed  NOT CAUGHT
N9  str returns its SECOND argument on the decoding path       0 failed  NOT CAUGHT
N10 str's zero-argument default stops being the empty string   0 failed  NOT CAUGHT

pristine sha256 fa636de8284dc00c -> restored fa636de8284dc00c  IDENTICAL
post-restore gate                                             0 failed | 51 passed
caught 6   not caught 10
```

The five mutations added for this revision are all NOT CAUGHT:

- **N7 and N8** move the set boundary in each direction independently. Neither
  is visible, so the gate cannot see the one-argument defer or the two-argument
  arity error — the collapse is unguarded from both sides.
- **N4b** shows the three-argument surplus is unguarded as well as the base, so
  a candidate that settles the second argument can leave the third silently
  consumed and stay green.
- **N9** lets `str` return its second argument on the decoding path with 51
  cells green.
- **N10** changes `str()`'s zero-argument result and nothing notices.

### A defect in this battery, found and fixed during the revision

The first run of the revised battery printed `caught 5` and, above it, one line
saying C5's anchor did not match. **C5 was skipped and the summary still stood.**
The cause: anchors in the harness are joined with LF, the checkout is CRLF, and
a multi-line anchor therefore cannot match. In 0088 it did match, because the
first text-mode run had rewritten the file to LF before the anchor was applied —
the bug and the condition that hid it were the same bug.

Two fixes: anchors are now rewritten to the file's own newline before matching,
and any anchor that fails to match makes the whole run exit non-zero with an
explicit statement that the counts are over a smaller population than claimed.
A skipped mutation is not "not caught"; it is not measured.

### The pristine hash differs from 0088 and the content does not

0088 recorded pristine `63321fefe898ea7c`; this run records `fa636de8284dc00c`.
Same file, same content:

```
worktree bytes now            fa636de8284dc00c   (CRLF, 1483 line endings, 0 bare LF)
same content, LF-normalised   63321fefe898ea7c   = the number recorded in 0088
git blob (authoritative)      c21d5960e8ead8299ae5df5e09c796639e52e3f0
```

---

## 5. `int(x, base)` — the implement-or-defer decision

0091 asks for cost, reachable shapes, oracle and NotMeasured. I recommend
**defer**, and the case is below rather than the conclusion alone.

### Reachable shapes

Across all 741 corpus programs, counting top-level arguments at every builtin
call site by balancing parentheses, with comments and string literals removed:

```
int    1 arg: 1464                       with a base: 0
str    1 arg: 12968                      with 2+:     0
set    1 arg: 7                          with 2+:     0
sum    1 arg: 53   2 args: 3
min    1 arg: 25   3 args: 1
max    1 arg: 38   2 args: 3   3 args: 1
```

Every non-one-argument count has a printed witness. The 2- and 3-argument `sum`,
`min` and `max` sites are `sum(daily, 100)`, `min(3, 7, 5)`, `max(2, 2.0)` —
all shapes CPython accepts. **There is no call to `int` with a base anywhere in
the corpus**, and no call to any builtin that CPython would reject. That is the
0088 finding restated on a second population: the corpus is written by someone
who writes correct calls, so like `builtin-shapes.test.ts` it cannot exercise
the arity contract.

A regex cannot produce this table. `int((a-b)/c)` and `def add_int(n, cent_i)`
both contain `int(` followed by a comma. The counter also got two things wrong
on its first run and both are recorded in its source: an argument that is
entirely bracketed never set the "an argument was present" flag, and `{}` was
untracked so set literals leaked their commas.

### Cost of implementing

Bases 0 and 2 through 36; prefix inference when base is 0; underscore
separators; leading and trailing whitespace; sign; and two exact message
families, `invalid literal for int() with base N: '...'` and `int() can't
convert non-string with explicit base`. That is a wider exact-message surface
than the one `need()` already gets wrong by sharing a single sentence across
four callers — which is finding N2 in this same census.

### Cost of deferring

One condition and one `Unsupported` with a reason. The mechanism exists, is
already used for `set(iterable)`, and 0088 measured that it terminates the run
as `eml:run:incomplete` correctly rather than as a silent pass.

### What each leaves NotMeasured

Deferring leaves the entire base contract unmeasured **and says so**.
Implementing leaves nothing unmeasured but adds thirty-five bases of message
surface that nothing in the corpus or the gate would exercise, which is the
condition under which the other message defects in this census arose.

### Why defer is the smaller and safer change

`int("101", 2)` returning `101` is the only **wrong value** in twenty-eight
rows. Deferring converts a wrong value into a refusal. Implementing converts it
into a right value plus a new untested message surface. Refusing to model
something and silently answering wrongly are the two outcomes this census
exists to separate, and defer moves this cell from the second to the first.

Implementing remains open and is not foreclosed by deferring first.

### Independent of the choice

`int(x, base, third)` must be an arity TypeError before either policy applies.
N4b shows the gate cannot see that today, so it needs its own assertion
whichever way the second argument is settled.

---

## 6. NotMeasured

- the base contract for `int(x, base)` — every base, prefix, underscore and sign rule, and both message families
- the exact wording of every arity rejection, for every builtin, in both directions
- `str` with a genuine bytes-like first argument and a real encoding, which is the path CPython's 2-3 argument form exists for
- `repr` beyond zero and one argument
- whether `set(a, b)` should reject before or after conversion is modeled
- evaluation order for the newly added shapes (measured for `abs` in 0088 and found to MATCH; not re-measured per shape here)

## 7. Boundaries

No product change, no candidate, no merge, no release, no deploy. 005 is not
reopened; 007-022, the registry, the trace error outcome contract and PR #3 /
#4 are untouched. The monitor ledger isolation landed separately as `127c961`
and is not part of this artifact.
