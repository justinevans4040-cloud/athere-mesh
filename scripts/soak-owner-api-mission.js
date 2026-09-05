import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

/**
 * Production soak: N consecutive owner-api A→B missions over live mesh env.
 * Requires the same ATHERE_MESH_* env as smoke-owner-api-mission.js.
 *
 *   node scripts/soak-owner-api-mission.js [count]
 *
 * Writes evidence/soak-owner-api-mission-<stamp>.json
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const count = Math.max(1, Number.parseInt(process.argv[2] ?? '5', 10) || 5);
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').slice(0, 15);

function requireEnv(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} is required for soak`);
  }
  return value.trim();
}

requireEnv('ATHERE_MESH_REDIS_HOST');
requireEnv('ATHERE_MESH_REDIS_SEED_ID');
requireEnv('ATHERE_MESH_REMOTE_REPOSITORY_ROOT');
requireEnv('ATHERE_MESH_POSTGRES_URL');
if (!['1', 'true', 'yes', 'on'].includes(String(process.env.ATHERE_MESH_REMOTE_WORK_QUEUE ?? '').toLowerCase())) {
  throw new Error('ATHERE_MESH_REMOTE_WORK_QUEUE must be truthy');
}

function runOnce(index) {
  return new Promise((resolve) => {
    const startedAt = new Date().toISOString();
    const child = spawn(process.execPath, ['scripts/smoke-owner-api-mission.js'], {
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
      let evidenceStatus = null;
      if (parsed?.evidence) {
        try {
          const body = JSON.parse(readFileSync(parsed.evidence, 'utf8'));
          evidenceStatus = body?.result?.status ?? null;
          if (body?.ok === false && !parsed.error) {
            parsed = { ...parsed, error: body.error ?? `mission status ${evidenceStatus}` };
          }
        } catch {
          // keep stdout parse only
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
        missionStatus: evidenceStatus,
        error: (() => {
          if (code === 0 && parsed?.ok === true) return null;
          if (parsed?.error) return parsed.error;
          const tail = stderr.trim().slice(-500);
          if (tail) return tail;
          return `exit ${code}; stdout_parse_failed=${parsed == null}`;
        })(),
      });
    });
  });
}

const runs = [];
for (let i = 1; i <= count; i += 1) {
  process.stdout.write(`soak ${i}/${count}...\n`);
  const result = await runOnce(i);
  runs.push(result);
  process.stdout.write(`${JSON.stringify({ i, ok: result.ok, error: result.error })}\n`);
  if (!result.ok) break;
}

const evidence = {
  ok: runs.length === count && runs.every((run) => run.ok === true),
  smoke: 'soak-owner-api-mission',
  claim: `${count} consecutive Lenovo→Ichabod owner-api missions complete with shared Postgres + shared proofs (Tailscale-native), zero mid-flight SSH.`,
  at: new Date().toISOString(),
  requestedRuns: count,
  completedRuns: runs.length,
  postgresUrlHost: (() => {
    try {
      const parsed = new URL(process.env.ATHERE_MESH_POSTGRES_URL);
      return `${parsed.hostname}:${parsed.port || '5432'}`;
    } catch {
      return null;
    }
  })(),
  runs,
};

const outDir = path.join(repoRoot, 'evidence');
await mkdir(outDir, { recursive: true });
const outPath = path.join(outDir, `soak-owner-api-mission-${stamp}.json`);
await writeFile(outPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ ok: evidence.ok, evidence: outPath, completedRuns: runs.length }, null, 2)}\n`);
process.exitCode = evidence.ok ? 0 : 1;
