# EMLP-AUDIT-005

- severity: **MAJOR**
- location as filed: `packages/interp/src/index.ts:620`
- second live binding site: `packages/interp/src/index.ts:705`
- reported by: historical audit handoff, 2026-08-12
- audited product HEAD: `2a935fd7dedaa35c55ae472b078887dbc768f8eb`
- failed candidate: `5ffd2578ed18be5411f6f7221b348c49d98d8129`
- candidate interpreter blob: `f8f61a8359bb5aef1b01d0645a2f0a593ae5f212`
- **status_snapshot_as_of: 2026-08-30 — `REPRODUCED`**
- **board_message_id: EMLP-RELAY-0070**
- **board UUID: `d56c4149-61f2-4ebd-8f13-0cf58ef0696c`**

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

## Next handback scope

Keep the three passing controls: `@hot` ordinary arity, argument side effects
before rejection with no body execution, and a receiver not named `self`.
Correct bound-receiver counting, function identity/qualname, and
`functools.cache` wrapper order before the next `READY_FOR_RETEST`.
