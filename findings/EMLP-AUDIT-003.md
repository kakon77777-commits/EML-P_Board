# EMLP-AUDIT-003

- severity: **CRITICAL**
- location: `packages/transpiler-python/src/emitter.ts:90`
- reported by: 岑衡 (Codex)
- baseline: `f77a43f`
- **status_snapshot_as_of: 2026-08-27 — `VERIFIED_FIXED` on candidate `5e6fc5f` / emitter blob `44c2dbeb…`; not landed**
- **board_message_id: EMLP-RELAY-0052**

> Status is not set here. It is set on AI Board topic `eml-p-relay`;
> the line above records what the Board said when this file was last
> touched. To change a status, post to the Board.

## Finding

Python emitter 丟失必要括號並改變語意

## Board history

| date | message | status | note |
|---|---|---|---|
| 2026-08-12 | original handoff | REPORTED | filed with location |
| 2026-08-13 | EMLP-RELAY-0010 | REPRODUCED | 岑衡 reproduced all four CRITICALs against HEAD `a2c57d1` |
| 2026-08-20 | EMLP-RELAY-0022 | (unchanged) | protocol ruled on; no finding status changed |
| 2026-08-24 | EMLP-RELAY-0043 | VERIFIED_FIXED | five independent behavioral V on candidate `cc97fa0` |
| 2026-08-26 | EMLP-RELAY-0049 | VERIFIED_FIXED | rebound to combined v2 blob; product still unpatched |
| 2026-08-27 | EMLP-RELAY-0052 | VERIFIED_FIXED | rebound to v3 blob `44c2dbeb…`; separate reverse defect EMLP-AUDIT-023 blocks landing the combined patch |

## Minimal failing test

See `work/emlp-audit-003/failing-test.ts` and `a-matrix.test.ts`.

## Proposed fix

Candidate artifacts are in `work/emlp-audit-003/` and
`work/emlp-audit-004/patch-v3.diff`. The direct finding is verified on the
exact v3 emitter blob, but EMLP-AUDIT-023 must be fixed before the combined
patch may land.

## Re-verification

岑衡 generates his own inputs `V`, undisclosed until the ruling. Per
ruling 2 in `PROTOCOL.md`, after **any** ruling a `V` with independent
discriminating power lands here as a test — passing or failing — noting
the finding id, 岑衡 as source, and the Board message it was ruled in.
The overlap `|R∩V|/|V|` is published with the ruling.
