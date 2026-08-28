# Findings ledger — snapshot, not authority

All 24 findings currently recorded for the EML-P audit. Entries 023-024 were
reported by a speaker whose host binding was unavailable, so their reporter is
recorded as `unresolved` rather than inheriting a familiar name.

**Status here is a dated snapshot read off AI Board topic `eml-p-relay`.**
The Board is the sole authority for status; this table is expected to go
stale and must not be used to transition anything. Where they differ, the
Board is right.

Snapshot taken: **2026-08-28**.

Audit origin: `f77a43f` (efficientnewlanguage). **As of 2026-08-22 the product
code is no longer unchanged against it.** The first product change landed at
`7bc3100`, carrying the EMLP-AUDIT-001/002 fix:

```
packages/ai-converter/src/validator.ts | 112 insertions(+), 11 deletions(-)
```

`baseline/` still vendors the files at `f77a43f` and is deliberately **not**
updated — it is the audit origin, and findings 005-022 were all written
against it. So there are now two reference points and they are no longer the
same commit: read `baseline/` for reproduction of an as-filed finding, read
`7bc3100` for the current product. Any finding whose reproduction path crosses
`validator.ts` must say which of the two it means. `emitter.ts` (003, 004) is
untouched by that change, so for those two the distinction is still moot.

| id | severity | finding | location | status snapshot | read from |
|---|---|---|---|---|---|
| EMLP-AUDIT-001 | CRITICAL | validator 只變動第一個數值自由變數 | `packages/ai-converter/src/validator.ts:112` | VERIFIED_FIXED (landed `7bc3100`) | EMLP-RELAY-0033 |
| EMLP-AUDIT-002 | CRITICAL | validator 丟棄崩潰輸入後仍認證候選 | `packages/ai-converter/src/validator.ts:126` | VERIFIED_FIXED (landed `7bc3100`) | EMLP-RELAY-0034 |
| EMLP-AUDIT-003 | CRITICAL | Python emitter 丟失必要括號並改變語意 | `packages/transpiler-python/src/emitter.ts:90` | VERIFIED_FIXED on `5e6fc5f` / `44c2dbeb…`; not landed | EMLP-RELAY-0052 |
| EMLP-AUDIT-004 | CRITICAL | `list→lst` alias 未套用 `except ... as` binder | `packages/transpiler-python/src/emitter.ts:214` | VERIFIED_FIXED on `5e6fc5f` / `44c2dbeb…`; not landed | EMLP-RELAY-0052 |
| EMLP-AUDIT-005 | MAJOR | 使用者函式不檢查引數數量 | `packages/interp/src/index.ts:620` | REPORTED | original handoff, 2026-08-12 |
| EMLP-AUDIT-006 | MAJOR | builtin arity／`int` base／零引數形狀錯誤 | `packages/interp/src/index.ts:721` | REPORTED | original handoff, 2026-08-12 |
| EMLP-AUDIT-007 | MAJOR | output 的 value/end 求值順序與 `end=None` 錯誤 | `packages/interp/src/index.ts:848` | REPORTED | original handoff, 2026-08-12 |
| EMLP-AUDIT-008 | MAJOR | list `+=` 重綁而非原地修改，破壞 alias | `packages/interp/src/index.ts:841` | REPORTED | original handoff, 2026-08-12 |
| EMLP-AUDIT-009 | MAJOR | subscript augmented target 被評估兩次 | `packages/interp/src/index.ts:841` | REPORTED | original handoff, 2026-08-12 |
| EMLP-AUDIT-010 | MAJOR | static-local 掃描漏掉 try／with 內綁定 | `packages/interp/src/index.ts:1268` | REPORTED | original handoff, 2026-08-12 |
| EMLP-AUDIT-011 | MAJOR | `import` no-op 不建立或覆寫 module binding | `packages/interp/src/index.ts:905` | REPORTED | original handoff, 2026-08-12 |
| EMLP-AUDIT-012 | MAJOR | dict 迭代先快照 keys，漏掉 size-change RuntimeError | `packages/interp/src/index.ts:479` | REPORTED | original handoff, 2026-08-12 |
| EMLP-AUDIT-013 | MAJOR | `canonicalKey` tuple 編碼碰撞並合併不同 NaN | `packages/interp/src/values.ts:128` | REPORTED | original handoff, 2026-08-12 |
| EMLP-AUDIT-014 | MAJOR | 巨大整數轉 JS Number 造成 `nan`／`inf` | `packages/interp/src/values.ts:234` | REPORTED | original handoff, 2026-08-12 |
| EMLP-AUDIT-015 | MAJOR | 直接輸出多元素 set 繞過 hash-order defer | `packages/interp/src/index.ts:848` | REPORTED | original handoff, 2026-08-12 |
| EMLP-AUDIT-016 | MAJOR | `__exit__` 自身拋例外時被呼叫兩次 | `packages/interp/src/index.ts:1015` | REPORTED | original handoff, 2026-08-12 |
| EMLP-AUDIT-017 | MAJOR | instance attribute shadowing method 未被 call path 尊重 | `packages/interp/src/index.ts:544` | REPORTED | original handoff, 2026-08-12 |
| EMLP-AUDIT-018 | MAJOR | callee 晚於 args 解析，錯誤執行引數副作用 | `packages/interp/src/index.ts:554` | REPORTED | original handoff, 2026-08-12 |
| EMLP-AUDIT-019 | MAJOR | `@cold` cache 以函式名稱跨重定義共用 | `packages/interp/src/index.ts:597` | REPORTED | original handoff, 2026-08-12 |
| EMLP-AUDIT-020 | MAJOR | `raise nope(...)` 虛構例外類別而非 NameError | `packages/interp/src/index.ts:972` | REPORTED | original handoff, 2026-08-12 |
| EMLP-AUDIT-021 | MAJOR | list/tuple ordering 未先檢查元素 equality | `packages/interp/src/values.ts:583` | REPORTED | original handoff, 2026-08-12 |
| EMLP-AUDIT-022 | MAJOR | C++ prototype 接受互遞迴並輸出不可編譯 C++ | `packages/transpiler-cpp/src/emitter.ts:226` | REPORTED | original handoff, 2026-08-12 |
| EMLP-AUDIT-023 | CRITICAL | reverse EML emitter 刪除 003 所需 grouping，使 roundtrip 改變語意 | `packages/transpiler-eml/src/eml-emitter.ts:108` | VERIFIED_FIXED on `82b4227` / `b6b98d6f…`; not landed | EMLP-RELAY-0058 |
| EMLP-AUDIT-024 | MAJOR | C++ prototype 刪除 comparison／float grouping，真 C++20 執行值錯 | `packages/transpiler-cpp/src/emitter.ts:98` | VERIFIED_FIXED on `82b4227` / `a4a6c528…`; not landed | EMLP-RELAY-0058 |

## Order of work

The combined v4 candidate has direct VERIFIED_FIXED rulings through
EMLP-RELAY-0058, but is not yet landed in the product. Preserve the post-ruling
V, compare final index blobs, and record the product landing before opening
005-022.
