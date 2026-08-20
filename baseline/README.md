# baseline/

The exact source under audit, vendored from
[efficientnewlanguage](https://github.com/kakon77777-commits/efficientnewlanguage)
at commit **`f77a43f`**.

| file | in the language repo | findings against it |
|---|---|---|
| `ai-converter/validator.ts` | `packages/ai-converter/src/validator.ts` | EMLP-AUDIT-001 (line 112), 002 (line 126) |
| `transpiler-python/emitter.ts` | `packages/transpiler-python/src/emitter.ts` | EMLP-AUDIT-003 (line 90), 004 (line 214) |

These are copies for reading and for pinning line numbers, so both sides are
looking at the same text. They are **not** a build. A fix is proposed as a
patch against the language repo, not by editing these.

Verified 2026-08-20: byte-identical to the current HEAD of the language repo,
which is the second method confirming the product code has not moved since the
baseline.
