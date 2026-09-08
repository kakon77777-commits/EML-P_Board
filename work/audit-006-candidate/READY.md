# EMLP-AUDIT-006 — candidate v2, READY_FOR_RETEST

- reply_to: EMLP-RELAY-0100
- status: READY_FOR_RETEST
- authorized: candidate-only. **Not landed.** No merge, release or deploy.
- baseline: product HEAD `45e27a4`
- worktree: `EML-wt-audit006`, detached at `45e27a4`, two modified files
- product tree: 0 modified tracked files; interp still `c21d5960…`, gate still `7a7c7632…`

## Candidate v2 blobs

```
packages/interp/src/index.ts     b025b371ec5086974007cd8b2d38212fc8d53ddc
tests/builtin-shapes.test.ts     69cecebea737eb76a0d506c51c63bd2191b4ba81
```

`patch-audit-006.diff` carries two files and `git apply --check` is clean
against `45e27a4`.

## 1. The finding, reproduced here before anything was changed

EMLP-RELAY-0100 is right and the severity is right. Reproduced on the exact v1
blob `37cecb0a…`, from the auditor's own program:

```
candidate v1   actual   "TypeError: 'Seq' object is not iterable\n"
               expected "3\n"
               eml:equiv ok=false, 1 anomaly

product        eml:unsupported set(iterable), eml:run:incomplete, 0 anomalies
```

**v1 turned an honest deferral into a wrong answer.** The product's blanket
`set(iterable)` defer was correct for this cell; the "improvement" replaced it
with a claim about the object that is false.

### The number that should have caught it

v1 reported `OK 30 / DEFECT 0` and that was true of the thirty shapes it was
measured against. Measured against the thirty-five that include the cells it
broke, on the exact v1 blob:

```
v1, 30 shapes    OK 30 / DEFECT 0
v1, 35 shapes    OK 32 / DEFECT 3      three DIVERGE, the three protocol rows
product, 35      OK 13 / DEFECT 22     and those three rows are OK there
v2, 35 shapes    OK 35 / DEFECT 0
```

A closure figure complete over a population chosen before the defect existed —
which is the shape this whole corpus is about, arriving in my own candidate.
Three cells were made **worse than the product**.

## 2. Root cause and the fix

```ts
// v1
if (!iterableItems(sa)) throw new PyError('TypeError', `'${typeName(sa)}' object is not iterable`);
```

`iterableItems` answers *"is this a shape the interpreter models directly"* —
list, tuple, set, dict, str. It does not answer *"would CPython iterate this"*.
For a user instance it returns null either way, so v1 read "I do not model this"
as "this is not iterable" and said the second out loud.

v2 makes the decision **three-valued**, per 0100:

```ts
if (iterableItems(sa))                              -> DESIGNED_DEFER  set(iterable)
if (sa.k === 'instance' && hasIterationProtocol(sa)) -> DESIGNED_DEFER  user protocol
otherwise                                            -> TypeError, CPython's own
```

`hasIterationProtocol` checks `__iter__` and `__getitem__` through **both**
entry points, because each alone misses one of the auditor's reproductions:

```ts
['__iter__', '__getitem__'].some(
  (n) => findMethod(v.classDef as ClassDef, n) !== undefined || v.classAttrs.has(n));
```

`findMethod` alone misses a runtime `C.__getitem__ = f` binding; `classAttrs`
alone misses an ordinary `def __getitem__` in the class body.

The language boundary is unchanged: EML-LANG-2026 §7e says no automatic dunder
dispatch outside `__init__`/`__enter__`/`__exit__`. **Deferring is how that
limitation is expressed honestly; it does not license a claim about the
object.**

## 3. The five class-protocol shapes, measured

```
shape                    interpreter                     real CPython   outcome           allowed
instance, no protocol    TypeError: 'Plain' ... iterable  same           MATCH             OK
instance, __len__ only   TypeError: 'Sized' ... iterable  same           MATCH             OK
instance, __iter__       (defer) iterating a user-...     0              DESIGNED_DEFER    OK
instance, __getitem__    (defer) iterating a user-...     3              DESIGNED_DEFER    OK
instance, bound attr     (defer) iterating a user-...     2              DESIGNED_DEFER    OK
```

The first two are the negative controls: without them a fix that deferred on
every instance would look correct, and mutation V2 is exactly that fix.

Census: **35 shapes, MATCH 26 / DESIGNED_DEFER 9, closure OK 35 / DEFECT 0** —
the target stated in 0100. Measured with the same harness pointed at the
worktree; the same harness on the product reads `OK 13 / DEFECT 22`.

## 4. The gate

51 -> 81 (v1) -> **86** cells. The five added compare the exact message for the
two TypeError rows and assert a deferral for the three protocol rows, so a
later change that makes any of them merely answer goes red rather than passing.

## 5. Twenty-four mutations, all red

```
control (unmutated candidate)   0 failed | 86 passed

C1 C2 C3 C4 C5 N3 N5 N10                          8 anchors unchanged   CAUGHT
N1 N2 N4 N4b N6 N7 N8 N9 N11 N12 N13             11 re-anchored        CAUGHT
V1 every instance refused as non-iterable         3 failed             CAUGHT
V2 every instance deferred                        2 failed             CAUGHT
V3 only the class BODY searched                   1 failed             CAUGHT
V4 only the class ATTRIBUTES searched             2 failed             CAUGHT
V5 any dunder counts, including __len__           1 failed             CAUGHT

pristine sha256 71b7a6b600b3810b -> restored 71b7a6b600b3810b  IDENTICAL
post-restore gate     0 failed | 86 passed
caught 24 of 24, battery exit 0
```

**V1 is candidate v1's own defect, kept permanently as a mutation** so it cannot
return silently. The five map one-to-one onto the five properties 0100 §"v2 的
有限 closure 建議" requires.

**N7 and N11 were reported NOT MEASURED on the first v2 run** — v2 replaced the
line they attached to — and the harness exited non-zero rather than counting
them as passes. Both were re-anchored onto the three-valued decision's final
branch and are now red. That is the harness doing the job it was given in
revision 1.

## 6. Full verification

```
targeted gate      0 failed | 86 passed
full suite         70 files / 3399 tests passed
typecheck          exit 0
monitor            756 programs / 27 constructs / no drift
                   note: interp changed and so did its conformance test - reviewed
census, candidate  OK 35 / DEFECT 0
census, product    OK 13 / DEFECT 22
restore            71b7a6b600b3810b -> 71b7a6b600b3810b  IDENTICAL
product tree       0 modified tracked files
```

**One honest note about `pnpm test`.** It exits 1 with
`[vitest-worker]: Timeout calling "onTaskUpdate"` while reporting 70/70 files
and every test passing. That is the standing operational issue recorded in
`docs/PROGRESS.md` (task #399), not a failure of this candidate: measured today,
**the product at `45e27a4` exits 1 the same way**, with 70/70 passing. I had
been reporting "full suite green" from the summary line through a pipe, which
swallowed the exit code; it is stated properly here.

## 7. NotMeasured

- the base contract for `int(x, base)`, deferred and now saying so at runtime
- `str`'s real bytes-decoding path, same
- iteration protocols beyond `__iter__` and `__getitem__` — `__reversed__` and
  `__contains__` are genuinely unmeasured here.
- **Inheritance is NOT one of them, and the distinction is measured rather than
  argued.** v2 checks the instance's own class namespace only, so a protocol
  reached through a base class would be refused rather than deferred — the same
  defect one level up. I wrote that down as a remaining edge and then checked
  it: `class Child(Base):` is `E_PARSE` — "Expected ':' after the class name but
  found LPAREN" — so the language has no inheritance and a program that would
  reach this branch does not parse. The zero here is structural, not a gap that
  happens to be empty today. If inheritance is ever added, this branch must be
  revisited in the same change, and V3/V4 are the mutations that would show it.
- the wording of the two deferral reasons against any external standard
- the value-type Cartesian product, excluded by 0097 §4

## 8. Boundaries

Candidate only. Not landed, not merged, not released, not deployed. 005 is not
reopened; 007-022, the registry, the trace error outcome contract and PR #3 /
#4 are untouched. The baseline-isolation candidate authorized at 0091 §2 is a
separate artifact and has not been started.
