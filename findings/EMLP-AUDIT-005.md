# EMLP-AUDIT-005

- severity: **MAJOR**
- location as filed: `packages/interp/src/index.ts:620`
- second live binding site: `packages/interp/src/index.ts:705`
- reported by: historical audit handoff, 2026-08-12
- audited product HEAD: `2a935fd7dedaa35c55ae472b078887dbc768f8eb`
- verified candidate v4: `691afd8468e9296a6718c4be7d45467b8caecd47`
- candidate interpreter blob: `c21d5960e8ead8299ae5df5e09c796639e52e3f0`
- **status_snapshot_as_of: 2026-08-30 — `VERIFIED_FIXED` (candidate; not landed)**
- **board_message_id: EMLP-RELAY-0082**
- **board UUID: `89ea8fb5-42af-4022-81de-396ab4ace9e2`**

> Status is set only on AI Board topic `eml-p-relay`. This file is a dated
> snapshot and a pointer to runnable evidence.

## Finding

User-defined functions and methods did not check positional arity. Missing
arguments became `None`; surplus arguments were dropped.

Candidate `5ffd257` fixed the public direct-call cases but failed eight
previously undisclosed inputs:

- zero-parameter bound method, `__init__`, and `__enter__` still execute even
  though Python implicitly passes the instance;
- zero-parameter `__exit__` and explicit-arg method messages undercount the
  implicit receiver;
- function aliases report the call-site alias instead of the function object's
  definition name;
- nested functions omit Python's qualified name;
- moving the check above `functools.cache` regresses an unhashable surplus
  argument from `unhashable type: 'list'` to an underlying arity error.

The post-ruling red-first test is
`work/audit-005/verification-unresolved-0070.test.ts`. On the failed candidate
it is 8 red / 3 green with exact discriminating-input overlap `0/8`.

Candidate v2 `b865f05` made those public cases green, but its
`Map<FunctionDef, string>` did not preserve the lexical owner of a class
defined inside a function. Instances keep only the bare `cls.name`, and the
method arity path builds `${instance.className}.${method.name}`; consequently
the outer function prefix is lost from both method errors and functions nested
inside those methods.

The second post-ruling test is
`work/audit-005/verification-unresolved-0073.test.ts`. Against exact v2
interpreter blob `171150f…`, its five discriminating rows are red and its
seven behavioral controls plus CPython guard are green:

```
candidate secret V     5 failed / 8 passed
public v2 R             37 passed
combined after restore  5 failed / 45 passed
```

A reversible diagnostic mutation that recorded the class qualname when the
`ClassDef` executed made all public and private rows green (50/50). Restoring
the file returned the exact candidate blob and the five red results.

Candidate v3 `335051a` made all 50 published rows green, including the
existing control for a class with no `__init__` receiving constructor
arguments. That control catches `TypeError` and prints only the literal
`"TypeError"`, however, so it discards the observable exception message.
The interpreter's separate no-`__init__` path adds a suffix CPython does not:

```
interpreter  Slate() takes no arguments (1 given)
CPython      Slate() takes no arguments
```

The third post-ruling test is
`work/audit-005/verification-unresolved-0076.test.ts`. Against exact v3
interpreter blob `0cb59a90…`, its five message-output rows are red and its
six behavioral controls plus CPython guard are green:

```
candidate secret V     5 failed / 7 passed
public v3 R             50 passed
combined after restore  5 failed / 57 passed
```

Changing the hidden message to `BROKEN-NO-INIT-MESSAGE` left the public gate
50/50 green, directly proving that the public control cannot guard message
fidelity. Removing only the non-CPython `(<N> given)` suffix made all 62
public and private rows green. Restoring the file returned the exact v3 blob
and the five red results.

Candidate v4 `691afd8` was built after a callable-contract census closed the
population over four deciding sites (S1 function frame, S2 no-`__init__`
constructor, S3 method/protocol frame, S4 shared message composer). Independent
source review confirmed there is no fifth user-call arity/message site in
scope; builtins remain 006 and the special raise path remains 020.

The successful acceptance test is
`work/audit-005/verification-unresolved-0082.test.ts`. Its 20 behavioral
cells plus one CPython guard sample every closed equivalence class with exact
source overlap `0/20`:

```
public matrix             72/72 passed
independent secret V      21/21 passed
independent drills        15/15 discriminating; restored 72/72
full suite                71 files / 3023 tests passed
typecheck                 exit 0
monitor                   621 programs / 27 constructs / no drift
```

The exact interpreter blob and LF-normalized SHA-256 matched the candidate.
Both source and built CLI emitted an `eml:equiv` event whose actual and
expected bytes were `"FinalEnvelope() takes no arguments\n"`.

## Closure and landing boundary

EMLP-AUDIT-005 is `VERIFIED_FIXED` for candidate `691afd8`. A future defect
outside the closed S1–S4 user-call arity/message root belongs to another
finding and does not reopen 005 automatically.

The product checkout is still `2a935fd` and still contains the original
defect. No product commit, merge, release, or deployment is authorized by this
snapshot. Product landing remains a separate Neo-authorized action.
