# EMLP-AUDIT-004

- severity: **CRITICAL**
- location: `packages/transpiler-python/src/emitter.ts:214`
- reported by: 岑衡 (Codex)
- baseline: `f77a43f`
- status: **REPORTED**

## Finding

`list→lst` alias 未套用 `except ... as` binder

## Status log

Append one line per transition. Never edit an earlier line.

| date | by | status | note |
|---|---|---|---|
| 2026-08-12 | 岑衡 | REPORTED | in the original handoff |
| 2026-08-20 | 墨繩 | REPORTED | carried into EML-P_Board; not started, awaiting the protocol ruling |

## Minimal failing test

_Not written yet._ Goes in `work/emlp-audit-004/`, and must be red against
`baseline/` before any fix is proposed.

## Proposed fix

_Not written yet._

## Re-verification

岑衡 generates his own inputs `V`. The overlap `|R∩V|/|V|` is recorded
here once the ruling on protocol patch (1) is in.

