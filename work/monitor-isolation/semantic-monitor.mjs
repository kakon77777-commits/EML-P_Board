#!/usr/bin/env node
/**
 * SEMANTIC DRIFT MONITOR.
 *
 * Every interpreter/CPython divergence found in this project so far was found
 * by accident: a corpus case happened to use a construct nobody had exercised,
 * and the execution-truth gate caught it. That worked, but it is luck with a
 * long tail — `Σ` waited 119 programs, `with` waited 134, and `%`-formatting
 * was broken for everything past `%s`/`%d`/`%f` the whole time.
 *
 * This turns that luck into a check. It reports two things:
 *
 *   COVERAGE — which shipped EML constructs no corpus program exercises. A
 *   construct at zero is a construct whose semantics nothing is testing, which
 *   is precisely where the divergences have been hiding.
 *
 *   DRIFT — semantics-bearing source files whose content hash has changed since
 *   the last recorded baseline, WITHOUT the matching conformance test being
 *   touched. Editing how `%` formats or how a cache keys is exactly the kind of
 *   change that should not land quietly.
 *
 * Usage:
 *   node scripts/semantic-monitor.mjs                    # report; exit 1 on a regression
 *   node scripts/semantic-monitor.mjs --accept           # record the current state
 *   node scripts/semantic-monitor.mjs --accept --why "…" # …required if alerts are open
 *
 * ── The ledger ────────────────────────────────────────────────────────────
 *
 * `scripts/semantic-monitor.jsonl` is an append-only record of what this
 * monitor has SEEN, alongside the baseline that records what it EXPECTS.
 *
 * The baseline alone was not enough. It stores a snapshot, so accepting an
 * alert overwrites the evidence: the alert fires, `--accept` moves the
 * baseline, and afterwards nothing in the repo says the alert ever existed or
 * why it was waved through. Since reaching for `--accept` is exactly the
 * temptation that shows up when you should be looking harder, an unauditable
 * accept is the weakest point in the whole design.
 *
 * So every run appends what it observed, and every acceptance appends what was
 * accepted — with a REASON, required whenever alerts are open. You can still
 * accept anything; you can no longer accept it silently.
 *
 * One line per event:
 *
 *   {"stream":"eml","proto":"eml-monitor-v1","seq":1,
 *    "ts":"2026-07-30T…","type":"monitor:alert","file":"…","reason":"…"}
 *
 *   monitor:run       every run — corpus size, construct count, alert count
 *   monitor:alert     one per alert raised
 *   monitor:accept    baseline recorded, carrying the reason given
 *
 * Structure borrowed from the append-only channel PHOSPHOR uses for agent
 * handoff — the SHAPE is a good idea worth reusing. The names are EML's own:
 * this project was deliberately made independent, and a monitor is not the
 * place to quietly reintroduce another project's vocabulary.
 *
 * Writing the ledger is best-effort. A monitor that cannot append must still
 * report, because failing to record is not a reason to stop checking.
 *
 * The baseline lives in scripts/semantic-monitor.baseline.json and is committed,
 * so the alert is about CHANGE rather than about absolute numbers — a construct
 * that was already at zero yesterday is reported but does not fail the build;
 * a construct that DROPS to zero, or a semantics file that moves without its
 * test, does.
 */
import { readFileSync, writeFileSync, appendFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const BASELINE = join(here, 'semantic-monitor.baseline.json');
// `--ledger <path>` redirects the append-only record. The default is the
// committed ledger and nothing but an explicit flag changes it: a flag is
// visible in the invocation and in a process list, where an environment
// variable would let a misconfigured runner silently divert the record of
// what ran. It exists because tests/semantic-monitor.test.ts drills this
// script for real - run, accept-refused, accept - and a drill that writes
// the real ledger puts eleven lines of rehearsal into the record of what
// actually happened, on every suite run.
const ledgerIndex = process.argv.indexOf('--ledger');
const LEDGER =
  ledgerIndex !== -1 && process.argv[ledgerIndex + 1]
    ? process.argv[ledgerIndex + 1]
    : join(here, 'semantic-monitor.jsonl');

/** EML's own protocol id. Not borrowed from anywhere — see the header note. */
const LEDGER_PROTO = 'eml-monitor-v1';

/** Next sequence number, continuing the existing ledger rather than restarting.
 *  A counter that resets makes two runs indistinguishable in the record. */
function nextSeq() {
  if (!existsSync(LEDGER)) return 1;
  try {
    const lines = readFileSync(LEDGER, 'utf8').split('\n').filter((l) => l.trim() !== '');
    if (lines.length === 0) return 1;
    return (JSON.parse(lines[lines.length - 1]).seq ?? 0) + 1;
  } catch {
    return 1; // unreadable tail: keep going rather than refuse to record
  }
}

let seq = nextSeq();

/** Append one event. Best-effort: a monitor that cannot write must still check. */
function record(type, fields) {
  const line = JSON.stringify({
    stream: 'eml',
    proto: LEDGER_PROTO,
    seq: seq++,
    ts: new Date().toISOString(),
    type,
    ...fields,
  });
  try {
    appendFileSync(LEDGER, line + '\n', 'utf8');
  } catch (e) {
    console.log(`  note:  could not append to the ledger (${e.code ?? 'error'}) — continuing`);
  }
}

/* ── 1. Construct coverage ────────────────────────────────────────────────── */

/**
 * Each entry is a SHIPPED EML construct and a matcher over comment-stripped
 * source. Deliberately excludes the interpreter-deferred ones (numpy `<M>`/`^T`,
 * `async`/`await`, `import`) — those can never have a runnable corpus case, so
 * reporting them as gaps would be noise that trains you to ignore the report.
 */
const CONSTRUCTS = [
  ['sigma-summation', (s) => s.includes('Σ(')],
  ['cold-annotation', (s) => /^\s*@cold\b/m.test(s)],
  ['hot-annotation', (s) => /^\s*@hot\b/m.test(s)],
  ['ternary', (s) => /\?[^"']*:/.test(s)],
  ['class', (s) => /^\s*class\s+\w+\s*:/m.test(s)],
  ['try-except', (s) => /^\s*except\b/m.test(s)],
  ['except-as', (s) => /^\s*except\b.*\bas\b/m.test(s)],
  ['raise', (s) => /^\s*raise\b/m.test(s)],
  ['finally', (s) => /^\s*finally\s*:/m.test(s)],
  ['with-context-manager', (s) => /^\s*with\s+/m.test(s)],
  ['list-comprehension', (s) => /\[[^\]]+\bfor\b[^\]]+\bin\b/.test(s)],
  ['slice', (s) => /\w\[\s*\w*\s*:\s*\w*\s*\]/.test(s)],
  ['dict-literal', (s) => /\{[^}]*:/.test(s)],
  ['percent-format', (s) => /%\s*\(/.test(s)],
  ['modulo', (s) => /\w\s+%\s+\w/.test(s)],
  ['and-or', (s) => /\b(and|or)\b/.test(s)],
  ['not', (s) => /\bnot\b/.test(s)],
  ['break', (s) => /^\s*break\b/m.test(s)],
  ['continue', (s) => /^\s*continue\b/m.test(s)],
  // Added 2026-08-01 with the statement itself. It will read 0 until a corpus
  // program uses it, which is the point: a construct the language accepts and
  // no program exercises is exactly what this counter exists to surface.
  ['pass', (s) => /^\s*pass\s*$/m.test(s)],
  ['while', (s) => /^\s*while\b/m.test(s)],
  ['compound-assign', (s) => /\^[+\-*/]/.test(s)],
  ['print-end', (s) => /\^0\s*\(/.test(s)],
  ['triple-quoted-string', (s) => s.includes('"""')],
  ['sequence-repeat', (s) => /("[^"]*"|\])\s*\*\s*\w/.test(s)],
  ['nested-def', (s) => /^\s+def\s+\w+\(/m.test(s)],
  ['float-division', (s) => /\w\s*\/\s*\w/.test(s)],
];

const BACKSLASH = String.fromCharCode(92);

/** Drop `#` comments, respecting string literals — an English word in prose
 *  must not count as a use of the construct it happens to name. */
function stripComments(src) {
  const out = [];
  for (const line of src.split('\n')) {
    let quote = null;
    let buf = '';
    let prev = '';
    for (const c of line) {
      if (quote) {
        buf += c;
        if (c === quote && prev !== BACKSLASH) quote = null;
      } else if (c === '"' || c === "'") {
        quote = c;
        buf += c;
      } else if (c === '#') {
        break;
      } else {
        buf += c;
      }
      prev = c;
    }
    out.push(buf);
  }
  return out.join('\n');
}

function corpusSources() {
  const dir = join(root, 'examples');
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('phase')) continue;
    for (const f of readdirSync(join(dir, entry.name))) {
      if (f.endsWith('.eml')) files.push(join(dir, entry.name, f));
    }
  }
  return files.map((f) => stripComments(readFileSync(f, 'utf8')));
}

function measureCoverage() {
  const sources = corpusSources();
  const counts = {};
  for (const [name, match] of CONSTRUCTS) {
    counts[name] = sources.filter((s) => match(s)).length;
  }
  return { programs: sources.length, counts };
}

/* ── 2. Semantics drift ───────────────────────────────────────────────────── */

/**
 * Files whose content decides what a program MEANS, each paired with the test
 * that pins it against real CPython. Changing the left without touching the
 * right is the shape of every silent divergence this project has shipped.
 */
const SEMANTIC_FILES = [
  [
    'packages/interp/src/values.ts',
    // Exception values live here too, not only in the interpreter — the first
    // real alert this monitor raised was for an exception-model change whose
    // tests were all in phase7d, which this list did not mention. Operator
    // semantics are here as well, which is why the matrix counts.
    [
      'tests/percent-format.test.ts',
      'tests/sum-compensation.test.ts',
      'tests/phase7d-exceptions.test.ts',
      'tests/builtin-shapes.test.ts',
      'tests/operator-matrix.test.ts',
      'tests/statement-interaction.test.ts',
    ],
  ],
  [
    'packages/interp/src/index.ts',
    [
      'tests/interp.test.ts',
      'tests/phase7d-exceptions.test.ts',
      'tests/builtin-shapes.test.ts',
      'tests/statement-interaction.test.ts',
      // Added 2026-08-04. The interpreter decides not only what a program
      // computes but what it RECORDS, and the record is what every golden,
      // every equivalence check and the workbench panel actually read. A
      // change that alters the trace without altering any of the tests above
      // is exactly the kind this monitor exists to stop, and it happened:
      // `eml:output` was dropping `end` and comprehensions emitted nothing.
      'tests/trace-completeness.test.ts',
      // Added 2026-08-08. Every test above compares what a program COMPUTES.
      // None of them can see the order the interpreter evaluates operands in,
      // because for pure operands every order produces the same value - which
      // is why a reordering here would have moved no test at all. Flipping the
      // two lines of the `Binary` case diverges 12 of 44 transcripts against
      // real CPython; before this entry existed, it diverged nothing.
      'tests/evaluation-order.test.ts',
      // Added 2026-08-09. `=>` binds a name to a VALUE, and for a mutable value
      // that means two names denote one object. Every test above compares what
      // a single expression PRINTS, and object identity is precisely what does
      // not show up in one expression's value - so an implementation that
      // copied on binding would compute the right answer everywhere they look.
      // Making `assign()` copy lists diverges 4 of 31 answers here; before this
      // entry existed it diverged nothing. Note it fired on 4 and not on the
      // parameter-passing cases: parameter binding is a different code path,
      // and the two can be wrong independently.
      'tests/aliasing-visibility.test.ts',
      // Added 2026-08-29 (EMLP-AUDIT-005). Every test above calls user
      // functions with the RIGHT number of arguments, because that is what a
      // test author writes, so none of them could see that the count was never
      // checked: a missing argument was bound to None and a surplus one was
      // dropped, and the call then succeeded with a plausible wrong value.
      // The entry above ends by noting that parameter binding is its own code
      // path and can be wrong independently — it was, in two places at once.
      // Deleting either arity check diverges 4 of 8 rows here against real
      // CPython; before this entry existed, deleting both diverged nothing.
      'tests/user-function-arity.test.ts',
      // Added the same day, and separate on purpose. The file above compares
      // the exception TYPE, which is the bar tests/builtin-shapes.test.ts sets,
      // and that bar cannot see three things a first fix got wrong: a bound
      // call delivers the receiver whether or not the method declared one, so a
      // zero-parameter method was the single shape the guard could not reject;
      // the label must come from the function object rather than the call site,
      // so an alias and a nested function were named wrongly; and functools
      // hashes its arguments before the wrapped signature is checked, so
      // rejecting arity above the cache turned `unhashable type: 'list'` into
      // an arity error the baseline had never produced. Deleting any one of the
      // three reds a distinct group here.
      'tests/user-function-arity-identity.test.ts',
      // Added 2026-08-30 (EMLP-RELAY-0073). The two files above record a
      // qualified name where a `def` executes; a class body's methods never
      // reach that branch, so a nested class lost its enclosing `<locals>`
      // prefix and every function defined inside its methods inherited the
      // truncated one. Three kinds of definition now have to agree, and this
      // file is the only place the third is checked.
      'tests/user-function-arity-nesting.test.ts',
      // Added 2026-08-30 (EMLP-RELAY-0076). instantiateClass has TWO arity
      // paths and only one goes through the shared arityError composer. The
      // three entries above were all written against the composer, and the
      // public suite's stand-in for the other one caught the exception and
      // printed the word TypeError, discarding the message. Rewriting that
      // hand-written message to a literal left all fifty of those cells
      // green. These rows print str(e), and their argument counts vary (1, 3,
      // 2, 3, 1, 1, 1) because the wrong message interpolated args.length —
      // an all-one-argument witness set cannot tell removing that count from
      // hardcoding the value every row happens to use.
      'tests/user-function-arity-constructor.test.ts',
      // Added 2026-08-30 (EMLP-RELAY-0079 census). The file above and the
      // three before it all read the interpreter's OUTPUT. None reads when
      // the guard fires: runMethodBody is one frame serving bound methods,
      // explicit __init__, __enter__ and both __exit__ paths, and moving its
      // guard below the eml:call emission takes the emitted count from 0 to 1
      // for a call whose body never runs while leaving all 62 cells green.
      // Only the plain-function case was ever asserted, in one row.
      'tests/user-function-call-order.test.ts',
    ],
  ],
  [
    'packages/transpiler-python/src/emitter.ts',
    [
      'tests/interp.test.ts',
      'tests/statement-interaction.test.ts',
      // Added 2026-08-11. The mutation operators in this axis are written
      // against the SHAPE of the emitted Python, so a change to what the
      // emitter produces silently changes what the operators mean - an operator
      // whose pattern no longer occurs reports "applicable 0" and looks like
      // good news. It is mapped here rather than to the interpreter because the
      // emitter is what it reads.
      'tests/gate-sensitivity.test.ts',
    ],
  ],
  // The FORWARD grammar was missing from this list entirely until 2026-08-01,
  // which is a hole the same shape as the bug found that day: a `pass`
  // statement was added to the lexer and parser, and nothing here would have
  // noticed if no test had moved with it. What a program MEANS is decided by
  // what the parser accepts, not only by what the interpreter does with it.
  ['packages/parser/src/parser.ts', ['tests/parser.test.ts', 'tests/statement-interaction.test.ts']],
  ['packages/parser/src/lexer.ts', ['tests/parser.test.ts', 'tests/statement-interaction.test.ts']],
  ['packages/transpiler-python/src/semantic.ts', ['tests/interp.test.ts', 'tests/statement-interaction.test.ts']],
  [
    'packages/transpiler-eml/src/eml-emitter.ts',
    // `rebinding-across-scopes` was added 2026-08-07 after this file's model of
    // "which names are declared" was found to disagree with the forward
    // analyzer's. The two listed before it both exercise the reverse path one
    // construct at a time, which is why neither could see it: the disagreement
    // only shows when ONE NAME is assigned in TWO scopes.
    // `grouping-round-trip` was added 2026-08-27 after EMLP-AUDIT-023: the
    // forward emitter was taught to keep a paren the AST requires and this
    // file was still removing it, so Python -> EML -> Python stopped being a
    // fixpoint. None of the three above could see it - each exercises the
    // reverse path for what it can EXPRESS, and this was about what it
    // silently REGROUPS.
    [
      'tests/reverse-regression.test.ts',
      'tests/reverse-blocks.test.ts',
      'tests/rebinding-across-scopes.test.ts',
      'tests/grouping-round-trip.test.ts',
    ],
  ],
  // Added 2026-08-27. This file was tracked by NOTHING, and it decides what a
  // program means once compiled - EMLP-AUDIT-024 shipped a grouping bug that
  // real MSVC computed differently from the interpreter, with the monitor
  // silent the whole time. The C++ back end is non-normative per spec §11,
  // which is a reason for a smaller blast radius, not for no drift check.
  [
    'packages/transpiler-cpp/src/emitter.ts',
    ['tests/transpiler-cpp.test.ts', 'tests/grouping-round-trip.test.ts'],
  ],
  ['packages/transpiler-eml/src/py-parser.ts', ['tests/reverse-regression.test.ts', 'tests/reverse-blocks.test.ts']],
  ['packages/transpiler-eml/src/py-lexer.ts', ['tests/reverse-regression.test.ts', 'tests/reverse-blocks.test.ts']],
  // Added 2026-08-05, and the third instance of the same hole. None of these
  // files were on this list at all, and every one of them decides what the
  // compiler CLAIMS about a program: whether a function is pure, how often it
  // is called, how deep the call graph runs, whether a loop terminates. That
  // account is what `eml explain`, the workbench panel and any agent reading
  // EML output take at face value, and a claim that drifts from the program
  // is self-consistent forever.
  //
  // The pattern to notice: the first hole was the forward grammar, the second
  // was the trace, this one is the semantic account. Each time the missing
  // files were ones that do not change what a program COMPUTES - which is
  // exactly why they were easy to leave off, and exactly why leaving them off
  // is a mistake.
  ['packages/transpiler-python/src/purity.ts', ['tests/cts-faithfulness.test.ts', 'tests/phase2-functions.test.ts']],
  ['packages/transpiler-python/src/importance.ts', ['tests/cts-faithfulness.test.ts', 'tests/phase2-functions.test.ts']],
  ['packages/transpiler-python/src/loop-classifier.ts', ['tests/cts-faithfulness.test.ts', 'tests/phase2-functions.test.ts']],
  ['packages/cts-generator/src/index.ts', ['tests/cts-faithfulness.test.ts', 'tests/bug-classifier.test.ts']],

  // FOURTH hole, 2026-08-06, and it breaks the pattern named just above.
  //
  // The transpiler's own entry point was absent from this map entirely. It is
  // not a description - it runs on every single compilation, and its emitter,
  // semantic pass, purity, importance and loop classifier are all listed while
  // the file that CALLS them was not. So the previous three holes were the
  // ones easy to explain, and this one says the map was never audited against
  // the file list at all; it grew one entry at a time as each file happened to
  // come up. A list maintained by accretion has holes wherever nothing
  // happened to draw attention.
  //
  // What it was hiding: the lex/parse diagnostic span carried a hardcoded
  // offset of 0 while its line and column were correct, so the two halves of
  // one span pointed at different places. Found by axis 12, not by this file.
  [
    'packages/transpiler-python/src/index.ts',
    ['tests/diagnostic-position.test.ts', 'tests/diagnostic-reachability.test.ts'],
  ],
];

const hashOf = (rel) => {
  const p = join(root, rel);
  if (!existsSync(p) || !statSync(p).isFile()) return null;
  // Hash NORMALIZED content. Hashing raw bytes made the monitor fire after any
  // `git checkout` on Windows, because .gitattributes restores CRLF where the
  // working copy had LF — a false alarm that teaches you to ignore the report,
  // which is worse than not having one. Found by drilling the monitor rather
  // than by trusting it.
  const CRLF = String.fromCharCode(13, 10);
  const LF = String.fromCharCode(10);
  const text = readFileSync(p, 'utf8').split(CRLF).join(LF);
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
};

function measureHashes() {
  const out = {};
  for (const [file, tests] of SEMANTIC_FILES) {
    out[file] = hashOf(file);
    for (const t of tests) out[t] = hashOf(t);
  }
  return out;
}

/* ── 3. Report ────────────────────────────────────────────────────────────── */

const accept = process.argv.includes('--accept');
/** `--why "reason"` — the justification recorded alongside an acceptance. */
const whyIndex = process.argv.indexOf('--why');
const why = whyIndex !== -1 ? (process.argv[whyIndex + 1] ?? '') : '';

const coverage = measureCoverage();
const hashes = measureHashes();
const current = { programs: coverage.programs, coverage: coverage.counts, hashes };

const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : null;

const alerts = [];
const notes = [];

// Coverage: zero is always worth SAYING; a drop is worth FAILING.
const uncovered = Object.entries(coverage.counts)
  .filter(([, n]) => n === 0)
  .map(([k]) => k);
if (uncovered.length > 0) {
  notes.push(`constructs with no corpus coverage: ${uncovered.join(', ')}`);
}
if (baseline) {
  for (const [name, n] of Object.entries(coverage.counts)) {
    const was = baseline.coverage?.[name];
    if (was === undefined) continue;
    // Only reaching ZERO is an alert. An earlier version also alerted on any
    // decrease, which meant deleting one case fired five alerts for constructs
    // that went 45 -> 44 — pure noise, and noise is how a monitor gets ignored.
    // A construct nothing exercises at all is the condition that actually
    // preceded every divergence found so far.
    if (was > 0 && n === 0) {
      alerts.push(`COVERAGE LOST     ${name} was exercised by ${was} program(s), now none`);
      record('monitor:alert', { kind: 'coverage-lost', construct: name, was, now: n });
    } else if (n < was) {
      notes.push(`${name} coverage ${was} -> ${n} (still covered)`);
    }
  }
}

// Drift: a semantics file moved without its conformance test moving.
if (baseline?.hashes) {
  for (const [file, tests] of SEMANTIC_FILES) {
    const changed = baseline.hashes[file] !== undefined && baseline.hashes[file] !== hashes[file];
    if (!changed) continue;
    // A test counts as touched if it CHANGED or if it is BRAND NEW. The first
    // version required `baseline.hashes[t] !== undefined`, so writing a whole
    // new conformance file — the strongest possible response to a semantics
    // change — did not satisfy the check, while editing one line of an old
    // test did. Found by the monitor alerting on exactly that situation.
    //
    // 2026-08-09: that fix left a hole, and the hole had been open for three
    // rounds. "Brand new" was read off the baseline, so a test file stayed
    // brand new for as long as the baseline went unaccepted — and the excuse it
    // grants is not about the file that changed, it is about a test added some
    // rounds ago. MEASURED: with the baseline at 9f3824f, an edit to
    // `assign()` in the interpreter that makes list binding COPY instead of
    // ALIAS — a change that moves 4 of 31 answers in aliasing-visibility —
    // produced "reviewed / no drift" with no test touched at all.
    //
    // So the two conditions are separated. An EDITED test is evidence about
    // this change. A test the baseline has never seen is evidence that the
    // BASELINE IS STALE, and it still excuses the change (the earlier fix's
    // reasoning holds) but says so out loud, so the excuse expires at the next
    // accept instead of standing forever.
    const seenInBaseline = (t) => baseline.hashes[t] !== undefined;
    const edited = tests.some((t) => hashes[t] !== null && seenInBaseline(t) && baseline.hashes[t] !== hashes[t]);
    const unseen = tests.filter((t) => hashes[t] !== null && !seenInBaseline(t));
    if (edited) {
      notes.push(`${file} changed, and so did its conformance test — reviewed`);
    } else if (unseen.length > 0) {
      notes.push(`${file} changed; excused by test(s) the baseline has never seen — see the STALE BASELINE alert`);
      alerts.push(
        `STALE BASELINE    ${file} changed, and the only thing excusing it is ${unseen.join(', ')},\n` +
          `                  which the baseline has no record of. Until the baseline is accepted, EVERY\n` +
          `                  future change to this file is excused by that same absence — the drift check\n` +
          `                  for it cannot fail. Run: pnpm monitor:accept -- --why "..."`,
      );
      record('monitor:alert', { kind: 'stale-baseline', file, unseen });
    } else {
      alerts.push(
        `SEMANTICS CHANGED ${file} changed but none of its conformance tests did\n` +
          `                  (${tests.join(', ')})\n` +
          `                  If the meaning of a program can differ, add or extend a test.\n` +
          `                  If it genuinely cannot, re-run with --accept --why "reason".`,
      );
      record('monitor:alert', { kind: 'semantics-changed', file, tests });
    }
  }
}

console.log(`semantic-monitor: ${coverage.programs} corpus programs, ${CONSTRUCTS.length} constructs tracked`);
for (const n of notes) console.log(`  note:  ${n}`);
for (const a of alerts) console.log(`  ALERT: ${a}`);

record('monitor:run', {
  programs: coverage.programs,
  constructs: CONSTRUCTS.length,
  alerts: alerts.length,
  notes: notes.length,
  accepting: accept,
});

if (accept) {
  // A reason is required exactly when there is something to justify. Accepting
  // a clean state is routine bookkeeping; accepting an OPEN ALERT is a
  // judgement call, and the judgement is the part worth keeping. Without this
  // the baseline moves and the repo retains no memory that anything was ever
  // flagged — which is how a monitor becomes a formality.
  if (alerts.length > 0 && why.trim() === '') {
    console.log(
      `\nRefusing to accept ${alerts.length} open alert(s) without a reason.\n` +
        `  Re-run as: pnpm monitor:accept -- --why "why this is safe"\n` +
        `  The reason is appended to scripts/semantic-monitor.jsonl, so a later\n` +
        `  reader can see what was waved through and on what grounds.`,
    );
    record('monitor:accept-refused', { alerts: alerts.length, reason: 'no --why given' });
    process.exit(1);
  }

  writeFileSync(BASELINE, JSON.stringify(current, null, 2) + '\n', 'utf8');
  record('monitor:accept', {
    programs: coverage.programs,
    alertsAccepted: alerts.length,
    why: why.trim() || '(clean state — routine baseline refresh)',
  });
  console.log(`semantic-monitor: baseline recorded (${coverage.programs} corpus programs)`);
  if (alerts.length > 0) console.log(`  accepted ${alerts.length} alert(s): ${why.trim()}`);
  process.exit(0);
}

if (!baseline) {
  console.log('  note:  no baseline yet — run with --accept to record one');
  process.exit(0);
}
if (alerts.length > 0) {
  console.log(`\n${alerts.length} alert(s). Nothing here is automatically wrong — it is a prompt to look.`);
  process.exit(1);
}
console.log('  no drift against the recorded baseline');
