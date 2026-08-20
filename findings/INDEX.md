# Findings ledger

All 22 findings from 岑衡's audit of EML-P, as handed over. Status is
append-only: entries are added, never rewritten. `VERIFIED_FIXED` is
岑衡's mark alone; the highest 墨繩 can set is `READY_FOR_RETEST`.

Baseline commit: `f77a43f` (efficientnewlanguage). As of 2026-08-20 the
product code is unchanged against that baseline — verified two ways:
`git diff --stat f77a43f HEAD -- packages/` is empty, and the vendored
copies in `baseline/` are byte-identical to current HEAD.

| id | severity | finding | location | status |
|---|---|---|---|---|
| EMLP-AUDIT-001 | CRITICAL | validator 只變動第一個數值自由變數 | `packages/ai-converter/src/validator.ts:112` | REPORTED |
| EMLP-AUDIT-002 | CRITICAL | validator 丟棄崩潰輸入後仍認證候選 | `packages/ai-converter/src/validator.ts:126` | REPORTED |
| EMLP-AUDIT-003 | CRITICAL | Python emitter 丟失必要括號並改變語意 | `packages/transpiler-python/src/emitter.ts:90` | REPORTED |
| EMLP-AUDIT-004 | CRITICAL | `list→lst` alias 未套用 `except ... as` binder | `packages/transpiler-python/src/emitter.ts:214` | REPORTED |
| EMLP-AUDIT-005 | MAJOR | 使用者函式不檢查引數數量 | `packages/interp/src/index.ts:620` | REPORTED |
| EMLP-AUDIT-006 | MAJOR | builtin arity／`int` base／零引數形狀錯誤 | `packages/interp/src/index.ts:721` | REPORTED |
| EMLP-AUDIT-007 | MAJOR | output 的 value/end 求值順序與 `end=None` 錯誤 | `packages/interp/src/index.ts:848` | REPORTED |
| EMLP-AUDIT-008 | MAJOR | list `+=` 重綁而非原地修改，破壞 alias | `packages/interp/src/index.ts:841` | REPORTED |
| EMLP-AUDIT-009 | MAJOR | subscript augmented target 被評估兩次 | `packages/interp/src/index.ts:841` | REPORTED |
| EMLP-AUDIT-010 | MAJOR | static-local 掃描漏掉 try／with 內綁定 | `packages/interp/src/index.ts:1268` | REPORTED |
| EMLP-AUDIT-011 | MAJOR | `import` no-op 不建立或覆寫 module binding | `packages/interp/src/index.ts:905` | REPORTED |
| EMLP-AUDIT-012 | MAJOR | dict 迭代先快照 keys，漏掉 size-change RuntimeError | `packages/interp/src/index.ts:479` | REPORTED |
| EMLP-AUDIT-013 | MAJOR | `canonicalKey` tuple 編碼碰撞並合併不同 NaN | `packages/interp/src/values.ts:128` | REPORTED |
| EMLP-AUDIT-014 | MAJOR | 巨大整數轉 JS Number 造成 `nan`／`inf` | `packages/interp/src/values.ts:234` | REPORTED |
| EMLP-AUDIT-015 | MAJOR | 直接輸出多元素 set 繞過 hash-order defer | `packages/interp/src/index.ts:848` | REPORTED |
| EMLP-AUDIT-016 | MAJOR | `__exit__` 自身拋例外時被呼叫兩次 | `packages/interp/src/index.ts:1015` | REPORTED |
| EMLP-AUDIT-017 | MAJOR | instance attribute shadowing method 未被 call path 尊重 | `packages/interp/src/index.ts:544` | REPORTED |
| EMLP-AUDIT-018 | MAJOR | callee 晚於 args 解析，錯誤執行引數副作用 | `packages/interp/src/index.ts:554` | REPORTED |
| EMLP-AUDIT-019 | MAJOR | `@cold` cache 以函式名稱跨重定義共用 | `packages/interp/src/index.ts:597` | REPORTED |
| EMLP-AUDIT-020 | MAJOR | `raise nope(...)` 虛構例外類別而非 NameError | `packages/interp/src/index.ts:972` | REPORTED |
| EMLP-AUDIT-021 | MAJOR | list/tuple ordering 未先檢查元素 equality | `packages/interp/src/values.ts:583` | REPORTED |
| EMLP-AUDIT-022 | MAJOR | C++ prototype 接受互遞迴並輸出不可編譯 C++ | `packages/transpiler-cpp/src/emitter.ts:226` | REPORTED |

## Order of work

Agreed with 岑衡 before the pause: **the four CRITICALs first, and each
root cause gets a minimal failing test before the fix.** 005-022 are not
opened until 001-004 are handed back, so that re-verification is not
reading a tree with several changes in it.

