import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * The monitor runs as part of the suite, not only as a command someone
 * remembers to type. There is no CI workflow in this repo, so `pnpm test` is
 * the only thing guaranteed to run before a commit — a monitor that has to be
 * invoked by hand is a monitor that reports to nobody.
 *
 * What it can fail on:
 *   - a semantics-bearing file changed without its conformance test
 *   - an EML construct stopped being exercised by any corpus program
 *
 * Neither is automatically a bug. The failure means "look at this", and
 * `pnpm monitor:accept` records the new state once it has been looked at.
 *
 * WHERE THESE RUNS ARE RECORDED. Drilling the monitor for real is the point of
 * this file — a mocked monitor would prove nothing about the one that runs.
 * But the monitor's ledger is the committed record of what actually happened,
 * and until this was fixed every suite run appended eleven lines of rehearsal
 * to it: two runs, an accept, a refusal, an accept, and the runs those imply.
 * Measured on the tree at 6d5d394, one `vitest run` of this file added 2295
 * bytes and 11 lines to `scripts/semantic-monitor.jsonl`.
 *
 * So every spawn below passes `--ledger` and writes to a disposable file. Two
 * things are deliberately NOT redirected:
 *
 *   - the two integrity tests read the COMMITTED ledger, because what they
 *     check is that artifact's well-formedness and sequence monotonicity, and
 *     pointing them at a file this test just created would test nothing;
 *   - the product default is untouched, which the null control in the
 *     handback measures rather than assumes.
 */
const here = dirname(fileURLToPath(import.meta.url));
const monitor = join(here, '..', 'scripts', 'semantic-monitor.mjs');
const ledger = join(here, '..', 'scripts', 'semantic-monitor.jsonl');

/** Disposable. Every spawn in this file writes here instead of the ledger. */
const drillLedger = join(here, '..', 'scripts', '.monitor-test-ledger.jsonl');

/**
 * Read once, at module load, before any test in this file has run. The last
 * test compares against it. Without this the isolation is a convention: a
 * future edit that spawns the monitor directly, or drops the flag from
 * `runMonitor`, would put rehearsal back into the committed record and every
 * test here would still be green.
 */
const committedLedgerAtLoad = readFileSync(ledger, 'utf8');

/** Spawn the monitor with the ledger redirected. There is no overload that
 *  forgets the flag: a test that wants to run the monitor calls this. */
function runMonitor(...args: string[]) {
  return spawnSync(process.execPath, [monitor, '--ledger', drillLedger, ...args], { encoding: 'utf8' });
}

function drillEvents(): Array<Record<string, unknown>> {
  if (!existsSync(drillLedger)) return [];
  return readFileSync(drillLedger, 'utf8')
    .trimEnd()
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

afterAll(() => {
  if (existsSync(drillLedger)) rmSync(drillLedger);
});

describe('semantic drift monitor', () => {
  it('reports no drift against the committed baseline', () => {
    const r = runMonitor();
    expect(r.error).toBeUndefined();
    expect(r.stdout + r.stderr, 'run `pnpm monitor` for detail, `pnpm monitor:accept` once reviewed').toContain(
      'no drift against the recorded baseline',
    );
    expect(r.status).toBe(0);
  });

  it('the baseline covers every construct the monitor tracks', () => {
    // Guards the guard: adding a construct to CONSTRUCTS without re-accepting
    // would leave it unmonitored (an undefined baseline entry is skipped).
    const r = runMonitor();
    const tracked = Number(/(\d+) constructs tracked/.exec(r.stdout)?.[1] ?? 0);
    expect(tracked).toBeGreaterThan(20);
  });

  it('appends to the ledger on every run', () => {
    const before = drillEvents().length;
    runMonitor();
    const after = drillEvents();
    expect(after.length, 'a run that records nothing leaves no evidence it happened').toBeGreaterThan(before);
    // Redirecting the ledger must not turn this file into a no-op: the run has
    // to still be recorded, and recorded as a run.
    expect(after.map((e) => e.type)).toContain('monitor:run');
  });

  it('every ledger line is one well-formed EML-native event', () => {
    // The COMMITTED ledger, read only. This is a property of the artifact in
    // the repository, not of anything this file produces.
    const lines = readFileSync(ledger, 'utf8').trimEnd().split('\n');
    for (const line of lines) {
      const e = JSON.parse(line);
      expect(e.stream).toBe('eml');
      // EML's own protocol id. This project was deliberately separated from
      // PHOSPHOR; the ledger borrows the append-only SHAPE and none of the
      // naming, and this assertion is what keeps that true under later edits.
      expect(e.proto).toBe('eml-monitor-v1');
      expect(e.proto).not.toMatch(/phosphor/i);
      expect(typeof e.seq).toBe('number');
      expect(typeof e.ts).toBe('string');
      expect(e.type).toMatch(/^monitor:/);
    }
  });

  it('sequence numbers are strictly increasing across the whole ledger', () => {
    // Also the committed ledger, and also read only. A counter that resets
    // makes two runs indistinguishable in the record.
    const seqs = readFileSync(ledger, 'utf8')
      .trimEnd()
      .split('\n')
      .map((l) => JSON.parse(l).seq);
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
  });
});

describe('accepting an open alert requires a stated reason', () => {
  /**
   * The baseline stores a snapshot, so accepting an alert USED TO overwrite the
   * only evidence it existed: the alert fired, the baseline moved, and nothing
   * in the repo remembered. Since `--accept` is precisely the thing one reaches
   * for when one should be looking harder, a silent accept was the weakest
   * point in the design.
   *
   * The committed baseline is doctored here and restored in `finally`. That is
   * a live-state mutation with a guard rather than a copy, and it is stated as
   * such: an earlier comment on this block claimed the drill ran against a
   * copy, while `tmp` was written and never read. The claim is removed rather
   * than the behaviour changed, because changing it is a separate finding.
   */
  it('refuses --accept without --why when alerts are open, and does not write', () => {
    const tmp = join(here, '..', 'scripts', '.monitor-drill-baseline.json');
    const real = join(here, '..', 'scripts', 'semantic-monitor.baseline.json');
    const original = readFileSync(real, 'utf8');
    try {
      // Start from a baseline that matches the working tree EXACTLY, then
      // doctor one entry. Doctoring the COMMITTED baseline instead made this
      // drill depend on the rest of the tree being clean: on a day when the
      // conformance tests had genuinely been edited, the monitor saw "source
      // changed AND its test changed", reported a note rather than an alert,
      // and `--accept` succeeded — so the drill failed for a reason that had
      // nothing to do with the refusal it exists to check.
      const seeded = runMonitor('--accept', '--why', 'drill setup');
      expect(seeded.status, 'seeding a matching baseline must succeed').toBe(0);

      // A baseline claiming a different hash for a real semantics file now
      // produces exactly the "changed without its test" alert, and it is the
      // ONLY thing that differs — no source file is touched.
      const doctored = JSON.parse(readFileSync(real, 'utf8'));
      doctored.hashes['packages/interp/src/values.ts'] = '0000000000000000';
      writeFileSync(tmp, JSON.stringify(doctored, null, 2) + '\n', 'utf8');
      writeFileSync(real, JSON.stringify(doctored, null, 2) + '\n', 'utf8');
      const refused = runMonitor('--accept');
      expect(refused.status, 'must refuse').toBe(1);
      expect(refused.stdout).toContain('without a reason');
      expect(readFileSync(real, 'utf8'), 'a refusal must not move the baseline').toBe(
        JSON.stringify(doctored, null, 2) + '\n',
      );

      const accepted = runMonitor('--accept', '--why', 'drill');
      expect(accepted.status, 'must accept once a reason is given').toBe(0);
      expect(readFileSync(real, 'utf8'), 'accepting DOES move the baseline').not.toBe(
        JSON.stringify(doctored, null, 2) + '\n',
      );

      // The redirect must not have cost the drill its evidence. Both outcomes
      // this block exists to distinguish have to be in the record, or the
      // isolation has turned a real drill into a pair of exit codes.
      const types = drillEvents().map((e) => e.type);
      expect(types, 'the refusal must be recorded').toContain('monitor:accept-refused');
      expect(types, 'the acceptance must be recorded').toContain('monitor:accept');
    } finally {
      writeFileSync(real, original, 'utf8'); // always restore the committed baseline
      if (existsSync(tmp)) rmSync(tmp);
    }
  });
});

describe('the drill does not write the record of what happened', () => {
  /**
   * Declared last so every spawn above has already run. This is the gate: it
   * is what turns the redirect from a convention into something a later edit
   * cannot quietly undo, and it fails on exactly one mistake — a monitor
   * invocation in this file that does not go through `runMonitor`.
   */
  it('the committed ledger is byte-for-byte what it was at module load', () => {
    expect(
      readFileSync(ledger, 'utf8'),
      'a monitor spawn in this file wrote the committed ledger; use runMonitor, which passes --ledger',
    ).toBe(committedLedgerAtLoad);
  });

  it('the drill ledger is a different file from the committed one', () => {
    // Guards the guard. Pointing --ledger at the committed path would satisfy
    // every assertion above and none of the point.
    expect(drillLedger).not.toBe(ledger);
  });
});
