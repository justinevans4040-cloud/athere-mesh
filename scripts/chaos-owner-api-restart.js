import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

/**
 * Death chaos: N cycles of owner smoke → restart worker+proxy → owner smoke.
 *
 *   node scripts/chaos-owner-api-restart.js [cycles]
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cycles = Math.max(1, Number.parseInt(process.argv[2] ?? '1', 10) || 1);
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').slice(0, 15);
const host = process.env.ATHERE_MESH_REDIS_HOST || '100.77.131.28';
const sshTarget = `the_founder@${host}`;

function requireEnv(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} is required for chaos`);
  }
  return value.trim();
}

requireEnv('ATHERE_MESH_REDIS_HOST');
requireEnv('ATHERE_MESH_REMOTE_REPOSITORY_ROOT');
requireEnv('ATHERE_MESH_POSTGRES_URL');

function ssh(remoteCommand) {
  const result = spawnSync(
    'ssh',
    ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=30', sshTarget, remoteCommand],
    { encoding: 'utf8' },
  );
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function runSmoke() {
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
        parsed = null;
      }
      resolve({
        startedAt,
        finishedAt: new Date().toISOString(),
        exitCode: code ?? 1,
        ok: code === 0 && parsed?.ok === true,
        evidence: parsed?.evidence ?? null,
        wiring: parsed?.wiring ?? null,
        error: parsed?.error ?? (code === 0 ? null : stderr.trim().slice(-400)),
      });
    });
  });
}

const steps = [];
let failed = false;

for (let cycle = 1; cycle <= cycles && !failed; cycle += 1) {
  process.stdout.write(`chaos cycle ${cycle}/${cycles} baseline...\n`);
  const baseline = await runSmoke();
  steps.push({ cycle, name: 'baseline', ...baseline });
  process.stdout.write(`${JSON.stringify({ cycle, name: 'baseline', ok: baseline.ok })}\n`);
  if (!baseline.ok) {
    failed = true;
    break;
  }

  process.stdout.write(`chaos cycle ${cycle}/${cycles} restart...\n`);
  const restart = ssh([
    'systemctl --user restart athere-mesh-postgres-tailscale.service',
    'systemctl --user restart athere-mesh-remote-executor.service',
    'sleep 2',
    'systemctl --user is-active athere-mesh-postgres-tailscale.service',
    'systemctl --user is-active athere-mesh-remote-executor.service',
    'ss -ltn | grep 5432',
  ].join(' && '));
  const restartOk = restart.ok && restart.stdout.includes('active');
  steps.push({
    cycle,
    name: 'restart_services',
    ok: restartOk,
    stdout: restart.stdout.trim(),
    stderr: restart.stderr.trim(),
  });
  process.stdout.write(`${JSON.stringify({ cycle, name: 'restart', ok: restartOk })}\n`);
  if (!restartOk) {
    failed = true;
    break;
  }

  process.stdout.write(`chaos cycle ${cycle}/${cycles} post-restart...\n`);
  const after = await runSmoke();
  steps.push({ cycle, name: 'post_restart', ...after });
  process.stdout.write(`${JSON.stringify({ cycle, name: 'post_restart', ok: after.ok })}\n`);
  if (!after.ok) failed = true;
}

const evidence = {
  ok: !failed && steps.length === cycles * 3 && steps.every((step) => step.ok === true),
  smoke: 'chaos-owner-api-restart',
  claim: `${cycles} chaos cycles: owner A→B, restart worker+Tailscale Postgres proxy, owner A→B again — all green.`,
  at: new Date().toISOString(),
  requestedCycles: cycles,
  steps,
};

const outDir = path.join(repoRoot, 'evidence');
await mkdir(outDir, { recursive: true });
const outPath = path.join(outDir, `chaos-owner-api-restart-${stamp}.json`);
await writeFile(outPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ ok: evidence.ok, evidence: outPath, steps: steps.length }, null, 2)}\n`);
process.exitCode = evidence.ok ? 0 : 1;
