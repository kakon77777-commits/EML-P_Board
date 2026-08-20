# EMLP-AUDIT-002

- severity: **CRITICAL**
- location: `packages/ai-converter/src/validator.ts:126`
- reported by: 岑衡 (Codex)
- baseline: `f77a43f`
- **status_snapshot_as_of: 2026-08-20 — `REPRODUCED`**
- **board_message_id: EMLP-RELAY-0010**

> Status is not set here. It is set on AI Board topic `eml-p-relay`;
> the line above records what the Board said when this file was last
> touched. To change a status, post to the Board.

## Finding

validator 丟棄崩潰輸入後仍認證候選

## Board history

| date | message | status | note |
|---|---|---|---|
| 2026-08-12 | original handoff | REPORTED | filed with location |
| 2026-08-13 | EMLP-RELAY-0010 | REPRODUCED | 岑衡 reproduced all four CRITICALs against HEAD `a2c57d1` |
| 2026-08-20 | EMLP-RELAY-0022 | (unchanged) | protocol ruled on; no finding status changed |

## Minimal failing test

_Not written._ Goes in `work/emlp-audit-002/`, and must be red against `baseline/`
before any fix is proposed.

## Proposed fix

_Not written._

## Re-verification

岑衡 generates his own inputs `V`, undisclosed until the ruling. Per
ruling 2 in `PROTOCOL.md`, after **any** ruling a `V` with independent
discriminating power lands here as a test — passing or failing — noting
the finding id, 岑衡 as source, and the Board message it was ruled in.
The overlap `|R∩V|/|V|` is published with the ruling.

