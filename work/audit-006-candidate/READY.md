# EMLP-AUDIT-006 — candidate, READY_FOR_RETEST

- reply_to: EMLP-RELAY-0097
- status: READY_FOR_RETEST
- authorized: candidate-only (0097). **Not landed.** No merge, release or deploy.
- baseline: product HEAD `127c961`
- worktree: `EML-wt-audit006`, detached at `127c961`
- product tree: 0 modified tracked files; `packages/interp/src/index.ts` still `c21d5960…`, `tests/builtin-shapes.test.ts` still `7a7c7632…`

## Candidate blobs

```
packages/interp/src/index.ts     37cecb0a355686bc9013d8514eb272f7777a733c
tests/builtin-shapes.test.ts     b154394340cf8366741661b816b772bc75b16d79
```

`patch-audit-006.diff` carries **two files only** and `git apply --check` is
clean against `127c961`. The worktree's own `scripts/semantic-monitor.jsonl` is
dirty from a monitor run and is deliberately excluded: shipping worktree state
in a patch is the mistake AUDIT-005 actually made on landing day.

## 1. The 30-shape matrix

```
raw outcomes   MATCH 24   DESIGNED_DEFER 6
closure        OK 30      DEFECT 0
```

Measured with the same harness as the census, pointed at the worktree
(`census-006.py <root>`), so the two numbers are comparable by construction
rather than by assertion. On the product the same command still reads
`OK 10 / DEFECT 20`.

The six designed defers are exactly the equivalence classes 0097 §2 fixed:
`set([1,2])`, `int("101",2)`, `int("5",2)`, `int(1,2)`, `str("a","b")`,
`str("a","b","c")`. `UNEXPECTED_DEFER` is 0.

## 2. What changed, and the order it decides in

**`checkArity(name, n)` runs before any builtin body.** An arity decision is
therefore never reached through a conversion question or a deferral — 0097 §3.3
and §3.4. Each region carries CPython's own sentence and the actual N,
harvested from real CPython 3.14.5 rather than recalled:

```
abs len repr   n != 1   NAME() takes exactly one argument (N given)
sum            n == 0   sum() takes at least 1 positional argument (0 given)
               n > 2    sum() takes at most 2 arguments (N given)
float          n > 1    float expected at most 1 argument, got N
int            n > 2    int expected at most 2 arguments, got N
str            n > 3    str expected at most 3 arguments, got N
set            n > 1    set expected at most 1 argument, got N
min max        n == 0   NAME expected at least 1 argument, got 0
```

The two `sum` directions are worded differently in CPython — "positional
argument" against "arguments" — which is why one shared sentence cannot serve a
region, let alone four builtins.

**`set` is four regions.** 0 legal; 1 iterable → the designed defer; 1
non-iterable → `'X' object is not iterable`, which CPython raises before any
conversion question; 2+ → arity, decided in `checkArity`. The single
`args.length > 0` that served all of them carried one sentence that was true
for one region and described something that was not happening for the others.

**`int` at exactly two arguments defers**; 3+ is arity, decided first.
**`str` at exactly two or three defers** (the bytes decoding path); 4+ is arity,
decided first.

**`min()` and `min([])` are split.** Zero arguments is a TypeError from
`checkArity`; an empty iterable is still the ValueError inside `minmax`. They
used to reach one line, which could not be right about both.

## 3. The gate

`tests/builtin-shapes.test.ts` goes from 51 to **81** cells. The 30 added cells
are the census population, and they compare the exact **message**: every probe
prints `str(e)`, because a row printing only the exception type would pass
against any wording — the failure this audit is about.

Seven of the added cells are **positive controls**: `repr(42)`, `str()`,
`str("a")`, `int()`, `int("10")`, `float()`, `set()`. Without them a fix that
rejected every call to a builtin would turn the block green; mutation N12 is
exactly that fix, and it now fails 11 cells.

Six cells assert the **deferrals** stay deferrals, so a later change that makes
any of them merely answer goes red rather than passing quietly.

## 4. All 19 census mutations now go red

0097 §3.5 requires every census mutation carried over by semantics, with any
inapplicable anchor marked and given an equivalent break rather than counted as
a pass. Eight anchors survived the candidate unchanged; eleven were re-anchored
and are labelled as such in `mutations-006-candidate.py` and its JSON.

```
control (unmutated candidate)   0 failed | 81 passed

C1  same        abs of a float loses its sign handling                  1 failed  CAUGHT
C2  same        int stops truncating toward zero                        2 failed  CAUGHT
C3  same        min/max of one argument stops iterating it              7 failed  CAUGHT
C4  same        sum stops refusing a string start                       1 failed  CAUGHT
C5  same        len stops sharing iterableItems                         6 failed  CAUGHT
N3  same        min/max empty-iterable raises the other exception type  3 failed  CAUGHT
N5  same        float's zero-argument default changes                   1 failed  CAUGHT
N10 same        str's zero-argument default stops being empty           1 failed  CAUGHT
N1  re-anchored the shared arity rejection stops rejecting              6 failed  CAUGHT
N2  re-anchored the shared arity message becomes a literal              6 failed  CAUGHT
N4  re-anchored int stops deferring and silently ignores the base       3 failed  CAUGHT
N4b re-anchored int's three-argument surplus stops being rejected       1 failed  CAUGHT
N6  re-anchored set stops declining an iterable and answers instead     1 failed  CAUGHT
N7  re-anchored set's non-iterable check disappears                     1 failed  CAUGHT
N8  re-anchored set's designed defer becomes an arity TypeError         2 failed  CAUGHT
N11 re-anchored set returns empty for a NON-iterable instead of refusing 1 failed CAUGHT
N13 re-anchored set's arity decision is swallowed by the conversion path 1 failed CAUGHT
N9  re-anchored str stops deferring the decoding path                   2 failed  CAUGHT
N12 re-anchored a repr arity fix also rejects the legal single argument 11 failed CAUGHT

pristine sha256 9d4393b0533e0444 -> restored 9d4393b0533e0444  IDENTICAL
post-restore gate     0 failed | 81 passed
caught 19 of 19
```

On the pre-candidate tree thirteen of these were NOT CAUGHT.

**Why each re-anchoring is the same mutation.** N1/N2 attacked `need()`, which
four builtins shared for their zero-argument rejection; the candidate decides
arity in `checkArity` before any body runs, so the sharing moved and the
mutations moved with it. N4/N4b attacked int's ignored second and third
arguments; those are now a defer and an arity check, so the equivalent break is
removing each. N6/N7/N8/N11/N13 attacked the one `args.length > 0` line that
served all four set regions; each re-anchors onto the region it was really
about. N9 attacked str reading its second argument; the equivalent break drops
the decoding defer, which restores exactly the old behaviour.

The harness exits non-zero if any anchor fails to match or any mutation stays
green, so a skipped row cannot sit quietly under a summary.

## 5. Full verification

```
targeted gate      0 failed | 81 passed
full suite         70 files / 3394 tests passed      (3364 before; +30 = the added cells)
typecheck          exit 0
monitor            741 programs / 27 constructs / no drift
                   note: interp changed and so did its conformance test - reviewed
census, candidate  OK 30 / DEFECT 0
census, product    OK 10 / DEFECT 20   (unchanged, so the product is untouched)
restore            9d4393b0533e0444 -> 9d4393b0533e0444  IDENTICAL
```

## 6. The documentation correction from 0097 §4

`CENSUS.md` §6 listed "whether `set(a, b)` should reject before or after
conversion is modeled" as NotMeasured while §2 of the same document had already
fixed it as `2+ → arity TypeError`. One document, open and closed. The line is
removed in this artifact's census update, and the candidate does not treat that
cell as a free option: `checkArity` decides it before the set body runs, and
N13 fails if that ordering is moved.

## 7. NotMeasured, still

- the base contract for `int(x, base)` — deferred, so every base, prefix,
  underscore and sign rule remains unmeasured, and now says so at runtime
- `str`'s real bytes-decoding path, for the same reason
- the exact wording of the two deferral reasons against any external standard;
  they are ours, not CPython's
- `repr` beyond zero, one and surplus
- the value-type Cartesian product, excluded by 0097 §4

## 8. Boundaries

Candidate only. Not landed, not merged, not released, not deployed. The product
tree is clean and its blobs are unchanged. 005 is not reopened; 007-022, the
registry, the trace error outcome contract and PR #3 / #4 are untouched. The
monitor baseline-isolation candidate authorized at 0091 §2 is a separate
artifact and has not been started.
