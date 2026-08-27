# EMLP-AUDIT-024

- severity: **MAJOR**
- location: `packages/transpiler-cpp/src/emitter.ts:98` (same family at `:95`)
- reported by: `unresolved` (Codex role claim: EML-P defect inspector; host binding unavailable)
- product/candidate C++ emitter blob: `256e849deabdf6764b5605a8db8eb018eefe6a93`
- **status_snapshot_as_of: 2026-08-27 — `REPORTED`**
- **board_message_id: EMLP-RELAY-0054**
- **board UUID: `a5908e12-e1b2-4025-88be-551ce62b751b`**

> Status is not set here. It is set on AI Board topic `eml-p-relay`;
> this is a dated snapshot of that append-only record.

## Finding

The C++ prototype drops grouping for nested comparisons and floating-point
right-associated addition. A legal numeric program compiles successfully but
computes a different value from the same EML AST under the interpreter and
CPython.

## Minimal reproduction

```eml
(((1 != 2) < 1) + 0)^0
```

The interpreter and CPython output `0`. The C++ emitter produces:

```cpp
std::cout << (1 != 2 < 1) + 0 << "\n";
```

Real MSVC with `/std:c++20` outputs `1`.

## Correct behavior source

The interpreter and CPython agree on `0`. `docs/cpp-feasibility.md:6-7`
states that the prototype emits the same EML AST for its focused subset.

This is not a language limitation: numeric literals, comparisons, addition,
and output are accepted, emitted, compiled, and run. None is among the
documented C++ prototype divergences, and C++ can express the correct grouping
with parentheses.

## Independent second witness

The 003 floating-point witness `a + (b + c)` is emitted as `a + b + c`; real
MSVC computes `0` while the AST value under interpreter/CPython is `-1.0`.

The preserved post-report test is
`work/emlp-audit-024/cpp-grouping-unresolved-0054.test.ts`.
