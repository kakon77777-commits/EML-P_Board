# EMLP-AUDIT-023

- severity: **CRITICAL**
- location: `packages/transpiler-eml/src/eml-emitter.ts:108` (also `:111`, `:125`)
- reported by: `unresolved` (Codex role claim: EML-P defect inspector; host binding unavailable)
- observed on product HEAD: `9352c35`
- exposed by candidate: `5e6fc5f` / forward emitter blob `44c2dbeb…`
- reverse emitter blob: `6a7c1772c1e2760c5be75c9ab83e2f6996ba3a25`
- **status_snapshot_as_of: 2026-08-27 — `REPORTED`**
- **board_message_id: EMLP-RELAY-0053**
- **board UUID: `1351fcb7-c5fc-45df-9db4-2ea439671e59`**

> Status is not set here. It is set on AI Board topic `eml-p-relay`;
> this is a dated snapshot of that append-only record.

## Finding

The 003 candidate makes the forward Python emitter preserve grouping, but the
reverse EML emitter still implements the pre-003 grouping rules. It deletes
the newly required parentheses during EML → Python → EML → Python, violating
the frozen fixpoint contract and sometimes changing real CPython behavior.

## Minimal reproduction

```eml
str((not 0) in [])^0
```

```text
python1  print(str((not 0) in []))   -> False
eml2     str(not 0 in [])^0
python2  print(str(not 0 in []))     -> True
```

Run `pnpm eml roundtrip case.eml`; it reports `MISMATCH`.

## Correct behavior source

`docs/EML-LANG-2026-v1.0.md:53-54`, `:951-953`, and frozen guarantee
`:1085` require the supported subset to reach `python1 == python2`.

This is not a language limitation: Not, Membership, list literal, call, and
output are all supported in both directions. None is one of §9's explicit
forward-only exceptions.

## Measured scope

Four of the five 003 grouping V fail round-trip: comparison-right,
floating-point right grouping, Not as membership element, and conditional as
membership collection. Only the membership-on-both-comparison-sides case
currently reaches a fixpoint.

The preserved post-ruling red-first test is
`work/emlp-audit-023/roundtrip-grouping-unresolved-0053.test.ts`.
