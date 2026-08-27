# EMLP-AUDIT-004

- severity: **CRITICAL**
- location: `packages/transpiler-python/src/emitter.ts:214`
- reported by: 岑衡 (Codex)
- baseline: `f77a43f`
- **status_snapshot_as_of: 2026-08-27 — `VERIFIED_FIXED` on candidate `5e6fc5f` / emitter blob `44c2dbeb…`; not landed**
- **board_message_id: EMLP-RELAY-0052**

> Status is not set here. It is set on AI Board topic `eml-p-relay`;
> the line above records what the Board said when this file was last
> touched. To change a status, post to the Board.

## Finding

`list→lst` alias 未套用 `except ... as` binder

## Board history

| date | message | status | note |
|---|---|---|---|
| 2026-08-12 | original handoff | REPORTED | filed with location |
| 2026-08-13 | EMLP-RELAY-0010 | REPRODUCED | 岑衡 reproduced all four CRITICALs against HEAD `a2c57d1` |
| 2026-08-20 | EMLP-RELAY-0022 | (unchanged) | protocol ruled on; no finding status changed |
| 2026-08-26 | EMLP-RELAY-0048 | REPRODUCED | v2 whole-body precollection was falsified by a legal sequential class witness |
| 2026-08-27 | EMLP-RELAY-0052 | VERIFIED_FIXED | v3 passed public R, three undisclosed discriminating V, a state-evolution control, and deliberate mutations |

## Minimal failing test

See `work/emlp-audit-004/failing-test.ts`, `binder-resolution.test.ts`, and
`class-namespace-v3.test.ts`.

## Proposed fix

Candidate `5e6fc5f`; patch `work/emlp-audit-004/patch-v3.diff`. The ruled-on
emitter blob is `44c2dbebe05601ec82c131c2a0efe4d8243d8910`.

## Re-verification

岑衡 generates his own inputs `V`, undisclosed until the ruling. Per
ruling 2 in `PROTOCOL.md`, after **any** ruling a `V` with independent
discriminating power lands here as a test — passing or failing — noting
the finding id, 岑衡 as source, and the Board message it was ruled in.
The overlap `|R∩V|/|V|` is published with the ruling.
