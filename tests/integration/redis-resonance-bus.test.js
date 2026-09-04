import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRedisResonanceBus, resolveRedisResonanceOptions } from '../../packages/resonance/src/redis-resonance-bus.js';
import { createRespClient } from '../../packages/resonance/src/resp-client.js';
import { runResonanceBusContract } from '../support/resonance-bus-contract.js';

// Offline-first: with no ATHERE_MESH_REDIS_* configuration these cases skip
// without touching the network, so `pnpm test` stays hermetic. When the mesh
// seed IS configured but unreachable, they skip with the transport reason
// instead of failing the suite.
const configured = resolveRedisResonanceOptions(process.env);
const runNamespace = `athere:mesh:test:resonance:${randomUUID()}`;

async function probeSeed(candidate) {
  const client = createRespClient({
    host: candidate.host,
    port: candidate.port,
    password: candidate.password,
    connectTimeoutMs: 2000,
    commandTimeoutMs: 2000,
  });
  try {
    await client.connect();
    const seed = await client.command(['GET', candidate.seedKey]);
    if (seed !== candidate.expectedSeedId) return `seed mismatch: found ${seed === null ? '<missing>' : seed}`;
    return null;
  } catch (error) {
    return error.message;
  } finally {
    await client.close();
  }
}

const unavailableReason = configured === null
  ? 'ATHERE_MESH_REDIS_* not configured (offline default)'
  : await probeSeed(configured);
const skip = unavailableReason === null ? false : `mesh Redis seed unavailable — ${unavailableReason}`;
const options = configured ? { ...configured, connectTimeoutMs: 5000, commandTimeoutMs: 5000 } : null;

runResonanceBusContract({
  label: 'redis resonance bus',
  createBus: () => createRedisResonanceBus({ ...options, namespace: runNamespace }),
  skip,
});

// ---------------------------------------------------------------------------
// Hermetic cases: no mesh seed required, so these run in the offline default.
// ---------------------------------------------------------------------------

test('redis resonance bus marks failClosedOnPublish for orchestrator injection', () => {
  const bus = createRedisResonanceBus({
    host: '127.0.0.1',
    port: 1,
    password: 'unused',
    expectedSeedId: 'never-reached',
    namespace: runNamespace,
  });
  assert.equal(bus.failClosedOnPublish, true);
});

test('redis resonance bus reports an unreachable host instead of failing silently', async () => {
  const bus = createRedisResonanceBus({
    host: '127.0.0.1',
    // Port 1 never has a listener, so this is a local connection refusal and
    // does not depend on any network being present.
    port: 1,
    password: 'unused',
    expectedSeedId: 'never-reached',
    namespace: runNamespace,
    connectTimeoutMs: 2000,
  });
  await assert.rejects(
    () => bus.publish({ id: 'signal-unreachable', missionId: 'mission-unreachable', type: 'running', agent: 'titan' }),
    /redis connection failed/i,
  );
  await assert.rejects(() => bus.read({ missionId: 'mission-unreachable' }), /redis connection failed/i);
  await bus.close();
});

test('redis resonance bus refuses to be constructed without an expected seed id', () => {
  assert.throws(
    () => createRedisResonanceBus({ host: '127.0.0.1', port: 6380, password: 'x' }),
    /expectedSeedId is required/i,
  );
});

test('redis resonance options are read from the environment', () => {
  assert.equal(resolveRedisResonanceOptions({}), null);

  const fromUrl = resolveRedisResonanceOptions({
    ATHERE_MESH_REDIS_URL: 'redis://:s3cr3t@10.0.0.5:6390',
    ATHERE_MESH_REDIS_SEED_ID: 'seed-a@host',
  });
  assert.equal(fromUrl.host, '10.0.0.5');
  assert.equal(fromUrl.port, 6390);
  assert.equal(fromUrl.password, 's3cr3t');
  assert.equal(fromUrl.expectedSeedId, 'seed-a@host');
  assert.equal(fromUrl.seedKey, 'athere:mesh:seed:id');
  assert.equal(fromUrl.namespace, 'athere:mesh:resonance');

  const fromParts = resolveRedisResonanceOptions({
    ATHERE_MESH_REDIS_HOST: '10.0.0.6',
    ATHERE_MESH_REDIS_PORT: '6391',
    ATHERE_MESH_REDIS_PASSWORD: 'pw',
    ATHERE_MESH_REDIS_SEED_ID: 'seed-b@host',
    ATHERE_MESH_REDIS_SEED_KEY: 'custom:seed',
    ATHERE_MESH_REDIS_NAMESPACE: 'custom:ns',
  });
  assert.equal(fromParts.host, '10.0.0.6');
  assert.equal(fromParts.port, 6391);
  assert.equal(fromParts.password, 'pw');
  assert.equal(fromParts.seedKey, 'custom:seed');
  assert.equal(fromParts.namespace, 'custom:ns');

  // A configured host with no expected seed id must fail loudly rather than
  // operate without the identity guard.
  assert.throws(
    () => resolveRedisResonanceOptions({ ATHERE_MESH_REDIS_HOST: '10.0.0.7' }),
    /ATHERE_MESH_REDIS_SEED_ID is required/i,
  );
  assert.throws(
    () => resolveRedisResonanceOptions({ ATHERE_MESH_REDIS_URL: 'not-a-url', ATHERE_MESH_REDIS_SEED_ID: 'seed' }),
    /ATHERE_MESH_REDIS_URL is not a valid redis url/i,
  );
});

test('redis resonance options can read the password from a file', async () => {
  // The seed host keeps the password in a mode-600 file. Reading it from there
  // keeps the secret out of argv and out of the environment of any process
  // that a shared box can list.
  const passwordFile = path.join(await mkdtemp(path.join(tmpdir(), 'athere-mesh-pass-')), 'mesh-redis.pass');
  await writeFile(passwordFile, 'file-sourced-password\n', 'utf8');

  const resolved = resolveRedisResonanceOptions({
    ATHERE_MESH_REDIS_HOST: '10.0.0.8',
    ATHERE_MESH_REDIS_PASSWORD_FILE: passwordFile,
    ATHERE_MESH_REDIS_SEED_ID: 'seed-c@host',
  });
  assert.equal(resolved.password, 'file-sourced-password');

  // An unreadable password file must fail loudly, not fall through to no auth.
  assert.throws(
    () => resolveRedisResonanceOptions({
      ATHERE_MESH_REDIS_HOST: '10.0.0.9',
      ATHERE_MESH_REDIS_PASSWORD_FILE: path.join(passwordFile, 'absent'),
      ATHERE_MESH_REDIS_SEED_ID: 'seed-d@host',
    }),
    /ATHERE_MESH_REDIS_PASSWORD_FILE could not be read/i,
  );
});

// ---------------------------------------------------------------------------
// Seed identity guard and auth failure: require the live mesh seed.
// ---------------------------------------------------------------------------

test('redis resonance bus refuses to operate when the seed identity differs', { skip }, async () => {
  const bus = createRedisResonanceBus({
    ...options,
    expectedSeedId: 'wrong-seed-00000000-0000-0000-0000-000000000000@nowhere',
    namespace: runNamespace,
  });
  await assert.rejects(
    () => bus.publish({ id: 'signal-wrong-seed', missionId: 'mission-wrong-seed', type: 'running', agent: 'titan' }),
    /mesh seed identity mismatch/i,
  );
  await bus.close();
});

test('redis resonance bus refuses to operate when a planted seed key holds another identity', { skip }, async () => {
  const plantedKey = `${runNamespace}:planted-seed`;
  const client = createRespClient(options);
  await client.connect();
  await client.command(['SET', plantedKey, 'some-other-seed@someotherhost']);
  await client.close();

  const bus = createRedisResonanceBus({ ...options, seedKey: plantedKey, namespace: runNamespace });
  await assert.rejects(
    () => bus.read({ missionId: 'mission-planted-seed' }),
    /mesh seed identity mismatch/i,
  );
  await bus.close();
});

test('redis resonance bus refuses to operate when the seed identity is missing', { skip }, async () => {
  const bus = createRedisResonanceBus({
    ...options,
    seedKey: `${runNamespace}:absent-seed`,
    namespace: runNamespace,
  });
  await assert.rejects(
    () => bus.publish({ id: 'signal-missing-seed', missionId: 'mission-missing-seed', type: 'running', agent: 'titan' }),
    /mesh seed identity missing/i,
  );
  await bus.close();
});

test('redis resonance bus reports an authentication failure explicitly', { skip }, async () => {
  const bus = createRedisResonanceBus({
    ...options,
    password: 'definitely-not-the-mesh-password',
    namespace: runNamespace,
  });
  await assert.rejects(
    () => bus.publish({ id: 'signal-bad-auth', missionId: 'mission-bad-auth', type: 'running', agent: 'titan' }),
    /redis authentication failed/i,
  );
  await bus.close();
});

test('redis resonance bus keeps signals durable across separate connections', { skip }, async () => {
  const missionId = `mission-durable-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const signal = { id: `${missionId}-s1`, missionId, type: 'accepted', agent: 'titan', at: '2026-09-03T18:00:00.000Z' };

  const writer = createRedisResonanceBus({ ...options, namespace: runNamespace });
  assert.deepEqual(await writer.publish(signal), { accepted: true, duplicate: false, sequence: 1 });
  await writer.close();

  // A completely separate client must observe the signal. That is the
  // in-process shape of the cross-host handoff.
  const reader = createRedisResonanceBus({ ...options, namespace: runNamespace });
  const read = await reader.read({ missionId });
  assert.equal(read.length, 1);
  assert.deepEqual(read[0], { ...signal, sequence: 1 });
  await reader.close();
});

test('redis resonance bus re-checks the seed on every operation, not once per instance', { skip }, async () => {
  // Verifying only on first connect is not enough. The client reconnects
  // transparently after a dropped socket or a Redis restart, so a guard that
  // caches its result would keep operating against whatever answers next --
  // exactly the silent-empty-stream failure the guard exists to prevent.
  const plantedKey = `${runNamespace}:reconnect-seed`;
  const plantedSeed = 'planted-reconnect-seed@nowhere';
  const missionId = `mission-reguard-${randomUUID().replace(/-/g, '').slice(0, 12)}`;

  const control = createRespClient(options);
  const bus = createRedisResonanceBus({
    ...options,
    seedKey: plantedKey,
    expectedSeedId: plantedSeed,
    namespace: runNamespace,
  });
  try {
    await control.connect();
    await control.command(['SET', plantedKey, plantedSeed]);
    assert.equal((await bus.publish({ id: `${missionId}-s1`, missionId, type: 'accepted', agent: 'titan' })).sequence, 1);

    // The seed identity is now gone underneath a bus that already passed once.
    await control.command(['DEL', plantedKey]);
    await assert.rejects(
      () => bus.publish({ id: `${missionId}-s2`, missionId, type: 'running', agent: 'jarvis' }),
      /mesh seed identity missing/i,
    );
    await assert.rejects(() => bus.read({ missionId }), /mesh seed identity missing/i);

    // A changed identity must be caught the same way.
    await control.command(['SET', plantedKey, 'someone-elses-seed@elsewhere']);
    await assert.rejects(
      () => bus.publish({ id: `${missionId}-s3`, missionId, type: 'running', agent: 'jarvis' }),
      /mesh seed identity mismatch/i,
    );
    await assert.rejects(() => bus.read({ missionId }), /mesh seed identity mismatch/i);

    // The refused writes must not have appended anything.
    await control.command(['SET', plantedKey, plantedSeed]);
    assert.equal((await bus.read({ missionId })).length, 1);
  } finally {
    await bus.close();
    await control.close();
  }
});

test('redis resonance bus reports the seed identity it actually read', { skip }, async () => {
  // Evidence must record what Redis returned, not what the caller expected, so
  // the guard hands back the value it read rather than a boolean.
  const bus = createRedisResonanceBus({ ...options, namespace: runNamespace });
  assert.equal(await bus.verifySeed(), options.expectedSeedId);
  await bus.close();

  const wrong = createRedisResonanceBus({
    ...options,
    seedKey: `${runNamespace}:absent-seed`,
    namespace: runNamespace,
  });
  await assert.rejects(() => wrong.verifySeed(), /mesh seed identity missing/i);
  await wrong.close();
});

test('redis resonance bus isolates namespaces', { skip }, async () => {
  // Two buses on different namespaces must not see each other, which keeps
  // evidence runs from colliding with live mission streams.
  const missionId = `mission-ns-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const busA = createRedisResonanceBus({ ...options, namespace: `${runNamespace}:a` });
  const busB = createRedisResonanceBus({ ...options, namespace: `${runNamespace}:b` });
  await busA.publish({ id: `${missionId}-a`, missionId, type: 'accepted', agent: 'titan' });
  assert.equal((await busA.read({ missionId })).length, 1);
  assert.equal((await busB.read({ missionId })).length, 0);
  await busA.close();
  await busB.close();
});

after(async () => {
  if (skip) return;
  // Remove every key this run created so the mesh seed keeps only real mission
  // data. noeviction means test keys would otherwise live forever.
  const client = createRespClient(options);
  await client.connect();
  let cursor = '0';
  const doomed = [];
  do {
    const [next, keys] = await client.command(['SCAN', cursor, 'MATCH', `${runNamespace}*`, 'COUNT', '500']);
    cursor = next;
    doomed.push(...keys);
  } while (cursor !== '0');
  if (doomed.length > 0) await client.command(['DEL', ...doomed]);
  await client.close();
});
