import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { interpret } from '@eml/interp';
import { transpileEmlToCpp } from '@eml/transpiler-cpp';

/**
 * Red-first V for EMLP-AUDIT-024.
 *
 * Speaker identity is unresolved: the host did not expose a current native
 * task/session identifier. The role claim is EML-P defect inspector.
 *
 * Board report: EMLP-RELAY-0054
 * Board id: a5908e12-e1b2-4025-88be-551ce62b751b
 * Product/candidate C++ emitter blob:
 *   256e849deabdf6764b5605a8db8eb018eefe6a93
 *
 * The behavioral witness was compiled and run with real MSVC C++20 on
 * 2026-08-27: interpreter/CPython output 0; generated C++ output 1.
 */

const COMPARISON = '(((1 != 2) < 1) + 0)^0\n';
const FLOAT =
  '0 - 1.0 => a\n10000000000000000.0 => b\n0 - 10000000000000000.0 => c\n(a + (b + c))^0\n';

type Toolchain = { kind: 'posix'; cmd: string } | { kind: 'msvc'; vcvars: string };

function findToolchain(): Toolchain | null {
  for (const cmd of ['g++', 'clang++']) {
    if (!spawnSync(cmd, ['--version'], { encoding: 'utf8' }).error) return { kind: 'posix', cmd };
  }
  if (process.platform === 'win32') {
    const vswhere = `${process.env['ProgramFiles(x86)']}\\Microsoft Visual Studio\\Installer\\vswhere.exe`;
    if (existsSync(vswhere)) {
      const r = spawnSync(vswhere, ['-latest', '-products', '*', '-property', 'installationPath'], {
        encoding: 'utf8',
      });
      const install = (r.stdout ?? '').trim().split(/\r?\n/)[0];
      if (install) {
        const vcvars = join(install, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat');
        if (existsSync(vcvars)) return { kind: 'msvc', vcvars };
      }
    }
  }
  return null;
}

function runAsync(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string; status: number }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
    child.on('error', (e) => resolve({ stdout, stderr: String(e), status: 1 }));
    child.on('close', (code) => resolve({ stdout, stderr, status: code ?? 1 }));
  });
}

async function compileAndRun(tc: Toolchain, cpp: string): Promise<{ stdout: string; stderr: string; status: number }> {
  const dir = mkdtempSync(join(tmpdir(), 'emlp-024-'));
  try {
    const src = join(dir, 'case.cpp');
    const exe = join(dir, 'case.exe');
    writeFileSync(src, cpp, 'utf8');
    if (tc.kind === 'posix') {
      const build = spawnSync(tc.cmd, ['-std=c++20', '-O0', src, '-o', exe], { encoding: 'utf8' });
      if (build.status !== 0) return { stdout: build.stdout ?? '', stderr: build.stderr ?? '', status: build.status ?? 1 };
      const run = spawnSync(exe, [], { encoding: 'utf8' });
      return { stdout: run.stdout ?? '', stderr: run.stderr ?? '', status: run.status ?? 1 };
    }
    const bat = join(dir, 'build.bat');
    const obj = join(dir, 'case.obj');
    writeFileSync(
      bat,
      [
        '@echo off',
        `call "${tc.vcvars}" >nul 2>&1`,
        `cl /nologo /std:c++20 /EHsc "${src}" /Fe:"${exe}" /Fo:"${obj}" >nul 2>&1 && echo @@case@@&& "${exe}"`,
      ].join('\r\n'),
      'utf8',
    );
    const result = await runAsync('cmd', ['/c', bat]);
    const match = /@@case@@\r?\n([\s\S]*)/.exec(result.stdout);
    if (!match) return { stdout: result.stdout, stderr: result.stderr, status: result.status || 1 };
    return { stdout: match[1]!, stderr: result.stderr, status: result.status };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('EMLP-AUDIT-024 — structural grouping coverage', () => {
  it('keeps a comparison nested on the left of another comparison', () => {
    const r = transpileEmlToCpp(COMPARISON);
    expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true);
    expect(r.cpp).toContain('std::cout << ((1 != 2) < 1) + 0 << "\\n";');
  });

  it('keeps floating-point right grouping for addition', () => {
    const r = transpileEmlToCpp(FLOAT);
    expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true);
    expect(r.cpp).toContain('std::cout << a + (b + c) << "\\n";');
  });
});

const toolchain = findToolchain();

describe.skipIf(!toolchain)('EMLP-AUDIT-024 — real C++20 behavior', () => {
  it(
    'computes the same numeric value as the EML interpreter',
    async () => {
      const ir = interpret(COMPARISON);
      expect(ir.error, JSON.stringify(ir.error)).toBeUndefined();
      expect(ir.output).toBe('0\n');
      const tr = transpileEmlToCpp(COMPARISON);
      expect(tr.ok, JSON.stringify(tr.diagnostics)).toBe(true);
      const run = await compileAndRun(toolchain!, tr.cpp);
      expect(run.status, run.stderr).toBe(0);
      expect(run.stdout.replace(/\r\n/g, '\n')).toBe(ir.output);
    },
    120_000,
  );
});
