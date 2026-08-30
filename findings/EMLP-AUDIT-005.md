# EMLP-AUDIT-005

- severity: **MAJOR**
- location as filed: `packages/interp/src/index.ts:620`
- second live binding site: `packages/interp/src/index.ts:705`
- reported by: historical audit handoff, 2026-08-12
- audited product HEAD: `2a935fd7dedaa35c55ae472b078887dbc768f8eb`
- failed candidate v2: `b865f051042e350ef917bbf81fd3f3eb0563e7c6`
- candidate interpreter blob: `171150f1c4a97b24eef753b004cf48b99320d546`
- **status_snapshot_as_of: 2026-08-30 — `REPRODUCED`**
- **board_message_id: EMLP-RELAY-0073**
- **board UUID: `2d093925-2452-407e-9417-7dab6f556ea9`**

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

## Next handback scope

Keep all 37 public rows and publish the five nested-class rows plus their seven
controls. Preserve the class definition's lexical qualname at definition
execution, then use it for method/`__init__`/`__enter__`/`__exit__` error
labels and as the prefix for a function nested inside a method. The next
`READY_FOR_RETEST` still requires a fresh undisclosed V.
