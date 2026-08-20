import { spawnSync } from 'node:child_process';

/** Resolve a usable Python interpreter; honors $EML_PYTHON. */
function resolvePython(): string | null {
  const override = process.env.EML_PYTHON;
  const candidates = override
    ? [override]
    : process.platform === 'win32'
      ? ['python', 'py', 'python3']
      : ['python3', 'python'];
  for (const cand of candidates) {
    const probe = spawnSync(cand, ['--version'], { encoding: 'utf8' });
    if (!probe.error && probe.status === 0) return cand;
  }
  return null;
}

// Unique marker so the probe value is never confused with the program's own stdout.
const SENTINEL = '~~EMLVAL7f3a~~';
const SPREAD = ['2', '3', '5', '7', '11', '4'];

interface RunResult {
  ok: boolean;
  /** Parsed target repr (text after the sentinel), or null if unavailable. */
  value: string | null;
  err: string;
}

function runPython(
  python: string,
  program: string,
  bindings: string,
  targetVariable: string,
  timeoutMs: number,
): RunResult {
  const code = `${bindings}\n${program}\nprint('${SENTINEL}' + repr(${targetVariable}))`;
  const res = spawnSync(python, ['-c', code], {
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    // Pin the hash seed so set/dict reprs are stable across the two processes.
    env: { ...process.env, PYTHONHASHSEED: '0' },
  });
  if (res.error || res.status !== 0) {
    const reason = res.signal ? `killed (${res.signal}; likely timeout)` : (res.stderr ?? '').trim() || res.error?.message || 'non-zero exit';
    return { ok: false, value: null, err: reason };
  }
  const out = res.stdout ?? '';
  const idx = out.lastIndexOf(SENTINEL);
  if (idx < 0) return { ok: false, value: null, err: 'probe marker not found in output' };
  return { ok: true, value: out.slice(idx + SENTINEL.length).trim(), err: '' };
}

export interface EquivalenceResult {
  equivalent: boolean;
  detail: string;
  /** True when the check could not run / could not be confirmed (fail-closed). */
  inconclusive?: boolean;
}

export interface ValidateOptions {
  timeoutMs?: number;
}

/** Extract `name = value` free-variable assignments from LLM-supplied binding strings. */
function parseFreeVars(bindings: string[]): { name: string; value: string; numeric: boolean }[] {
  const seen = new Map<string, { name: string; value: string; numeric: boolean }>();
  for (const b of bindings) {
    for (const line of b.split('\n')) {
      const m = /^\s*([A-Za-z_]\w*)\s*=\s*(.+?)\s*$/.exec(line);
      if (m && !seen.has(m[1]!)) {
        const value = m[2]!;
        seen.set(m[1]!, { name: m[1]!, value, numeric: /^-?\d+(\.\d+)?$/.test(value) });
      }
    }
  }
  return [...seen.values()];
}

/**
 * Round-trip equivalence check. CRITICAL: it does NOT trust the LLM's own test
 * inputs (conflict of interest — the same model proposed the suggestion). When
 * the free variables are numeric, the validator generates its OWN diverse,
 * non-degenerate inputs (>=2, non-empty ranges) so a wrong suggestion cannot
 * hide behind a binding like `n=1` or an empty range `n=0`. It also requires the
 * inputs to actually discriminate (>=2 distinct original outputs) before
 * certifying. Execution is hardened: timeout, output cap, pinned hash seed,
 * isolated probe.
 */
export function validateEquivalence(
  original: string,
  compiled: string,
  targetVariable: string,
  llmBindings: string[],
  options: ValidateOptions = {},
): EquivalenceResult {
  const python = resolvePython();
  if (!python) return { equivalent: false, inconclusive: true, detail: 'no Python interpreter found; cannot validate' };
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(targetVariable)) {
    return { equivalent: false, detail: `invalid target variable '${targetVariable}'` };
  }
  const timeoutMs = options.timeoutMs ?? 5000;

  const freeVars = parseFreeVars(llmBindings);
  const allNumeric = freeVars.length > 0 && freeVars.every((v) => v.numeric);

  // Build the binding sets the validator will actually test.
  let testSets: string[];
  if (allNumeric) {
    // Vary the first numeric var across a diverse, non-degenerate spread; hold
    // others at 3. LLM-supplied values are intentionally ignored here.
    const first = freeVars[0]!.name;
    testSets = SPREAD.map((v) => freeVars.map((fv) => `${fv.name} = ${fv.name === first ? v : '3'}`).join('\n'));
  } else {
    // Non-numeric or no free vars: best effort with the LLM bindings.
    testSets = llmBindings.length > 0 ? [...llmBindings] : [''];
  }
  // The LLM's own bindings must also agree where usable (extra checks, never sole evidence).
  const sets = [...new Set([...testSets, ...llmBindings])];

  const usable: { orig: string; comp: string }[] = [];
  for (let i = 0; i < sets.length; i++) {
    const bindings = sets[i] ?? '';
    const a = runPython(python, original, bindings, targetVariable, timeoutMs);
    const b = runPython(python, compiled, bindings, targetVariable, timeoutMs);
    if (!a.ok || !b.ok) continue; // skip unusable inputs (errors, timeouts)
    usable.push({ orig: a.value!, comp: b.value! });
  }

  if (usable.length === 0) {
    return { equivalent: false, inconclusive: true, detail: 'no usable test input (every binding errored or timed out)' };
  }
  // Agreement: every usable input must match.
  for (const u of usable) {
    if (u.orig !== u.comp) {
      return { equivalent: false, detail: `${targetVariable}: original=${u.orig} != compiled=${u.comp}` };
    }
  }
  // Discrimination: when there are free variables, the inputs must actually
  // exercise the computation (otherwise a degenerate input proves nothing).
  if (freeVars.length > 0) {
    const distinct = new Set(usable.map((u) => u.orig)).size;
    if (usable.length < 2 || distinct < 2) {
      return {
        equivalent: false,
        inconclusive: true,
        detail: 'could not confirm — test inputs do not exercise the computation (need >=2 discriminating inputs)',
      };
    }
  }
  return { equivalent: true, detail: `equivalent across ${usable.length} validator-chosen input(s)` };
}
