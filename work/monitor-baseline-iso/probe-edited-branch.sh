#!/bin/sh
# Reproduces EMLP-RELAY-0107 section 5 in a worktree at d2c2a0d.
# The committed baseline's entries for the interpreter and its conformance test
# predate the 006 landing, so `edited` is permanently true for that pair.
set -e
echo "--- a real semantics change to the interpreter, no test touched ---"
sed -i "s/if (a.k === 'float') return FLOAT(Math.abs(a.v));/if (a.k === 'float') return FLOAT(a.v);/" packages/interp/src/index.ts
echo "--- the builtin gate ---"
npx vitest run tests/builtin-shapes.test.ts --reporter=basic 2>&1 | grep -E "Tests "
echo "--- the monitor ---"
node scripts/semantic-monitor.mjs --ledger /tmp/probe.jsonl 2>&1 | tail -3
echo "monitor exit=$?"
git checkout -- packages/interp/src/index.ts
