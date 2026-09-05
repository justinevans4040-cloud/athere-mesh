import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

/**
 * HTTP /api/commands soak — N consecutive owner HTTP A→B missions.
 *
 *   node scripts/soak-owner-api-commands-http.js [count]
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const count = Math.max(1, Number.parseInt(process.argv[2] ?? '5', 10) || 5);
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').slice(0, 15);

function requireEnv(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} is required for HTTP soak`);
  }
  return value.trim();
}

requireEnv('ATHERE_MESH_REDIS_HOST');
requireEnv('ATHERE_MESH_REMOTE_REPOSITORY_ROOT');
requireEnv('ATHERE_MESH_POSTGRES_URL');

function runOnce(index) {
  return new Promise((resolve) => {
    const startedAt = new Date().toISOString();
    const child = spawn(process.execPath, ['scripts/smoke-owner-api-commands-http.js'], {
      cwd: repoRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => {
      let parsed = null;
      try {
        parsed = JSON.parse(stdout.trim());
      } catch {
        const match = stdout.match(/\{[\s\S]*\}\s*$/);
        if (match) {
          try {
            parsed = JSON.parse(match[0]);
          } catch {
            parsed = null;
          }
        }
      }
      resolve({
        index,
        startedAt,
        finishedAt: new Date().toISOString(),
        exitCode: code ?? 1,
        ok: code === 0 && parsed?.ok === true,
        wiring: parsed?.wiring ?? null,
        evidence: parsed?.evidence ?? null,
        error: parsed?.error ?? (code === 0 ? null : stderr.trim().slice(-500) || `exit ${code}`),
      });
    });
  });
}

const runs = [];
for (let i = 1; i <= count; i += 1) {
  process.stdout.write(`http-soak ${i}/${count}...\n`);
  const result = await runOnce(i);
  runs.push(result);
  process.stdout.write(`${JSON.stringify({ i, ok: result.ok, error: result.error })}\n`);
  if (!result.ok) break;
}

const evidence = {
  ok: runs.length === count && runs.every((run) => run.ok === true),
  smoke: 'soak-owner-api-commands-http',
  claim: `${count} consecutive Lenovo HTTP POST /api/commands A→B missions complete with shared Postgres + shared proofs.`,
  at: new Date().toISOString(),
  requestedRuns: count,
  completedRuns: runs.length,
  runs,
};

const outDir = path.join(repoRoot, 'evidence');
await mkdir(outDir, { recursive: true });
const outPath = path.join(outDir, `soak-owner-api-commands-http-${stamp}.json`);
await writeFile(outPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ ok: evidence.ok, evidence: outPath, completedRuns: runs.length }, null, 2)}\n`);
process.exitCode = evidence.ok ? 0 : 1;
