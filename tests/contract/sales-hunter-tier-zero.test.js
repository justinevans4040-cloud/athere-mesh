import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSalesHunterExecutor } from '../../packages/execution/src/sales-hunter-executor.js';
import { createRoleCapabilityExecutor } from '../../packages/execution/src/role-capability-executor.js';
import { fleetRegistry } from '../../packages/fleet/src/registry.js';

async function withForgeFrontStateStub(handler, run) {
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString('utf8');
    await handler(req, res, body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

test('Sales Hunter tier-zero fails closed without offer + segment + close date', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'sales-hunter-'));
  const hunter = createSalesHunterExecutor({ workspaceRoot });
  await assert.rejects(
    () => hunter.huntOutbound({ text: 'go sell something' }),
    /offer|segment|close date/i,
  );
});

test('Sales Hunter tier-zero builds qualified pipeline + drafts only (never send) with durable proof', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'sales-hunter-'));
  const hunter = createSalesHunterExecutor({ workspaceRoot });
  const result = await hunter.huntOutbound({
    offer: 'Athere Mesh local AI OS for CNC shops',
    segment: 'US job shops with 10-80 machines',
    closeDate: '2026-10-15',
    location: 'Midwest',
    leads: [
      { name: 'Precision Tooling Co', fit: 'high', signal: 'hiring CNC programmers' },
      { name: 'Random Coffee Cart', fit: 'low', signal: 'food truck' },
      { name: 'Midwest Proto Labs', fit: 'high', signal: 'quoted new 5-axis cell' },
    ],
  });

  assert.equal(result.capabilityId, 'outbound-acquisition');
  assert.equal(result.action, 'hunt_outbound');
  assert.equal(result.tier, 0);
  assert.equal(result.decision, 'PIPELINE_READY');
  assert.equal(result.sendAuthorized, false);
  assert.equal(result.deniedTools.includes('outreach_send'), true);
  assert.ok(result.pipeline.length >= 2);
  assert.ok(result.pipeline.every((lead) => lead.stage && lead.disqualified !== undefined));
  assert.equal(result.pipeline.filter((lead) => lead.disqualified).length, 1);
  assert.ok(result.drafts.length >= 2);
  assert.ok(result.drafts.every((draft) => draft.cta && draft.body.length < 600));
  assert.ok(result.drafts.every((draft) => draft.screened?.safe === true));
  assert.match(result.proofSha256, /^[a-f0-9]{64}$/);
  assert.ok(result.artifactPath);

  const artifact = JSON.parse(await readFile(path.join(workspaceRoot, result.artifactPath), 'utf8'));
  assert.equal(artifact.sendAuthorized, false);
  assert.equal(artifact.agentId, 'sales_hunter');
});

test('role capability executor routes outbound-acquisition through Sales Hunter T0', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'sales-hunter-role-'));
  const exec = createRoleCapabilityExecutor({ repositoryRoot: process.cwd(), workspaceRoot });
  const result = await exec.execute('outbound-acquisition', {
    agentId: 'sales_hunter',
    offer: 'Mesh install for back-office CNC ops',
    segment: 'contract manufacturers',
    closeDate: '2026-11-01',
  });
  assert.equal(result.capabilityId, 'outbound-acquisition');
  assert.equal(result.tier, 0);
  assert.equal(result.decision, 'PIPELINE_READY');
});

test('Sales Hunter T0 merges pipeline into ForgeFront /api/state CRM (drafts only, never send)', async () => {
  let stored = { solarSales: { leads: [], sessions: [] }, solarLeads: [], meta: { revision: 3 } };
  const puts = [];

  await withForgeFrontStateStub(async (req, res, body) => {
    if (req.method === 'GET' && req.url === '/api/state') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(stored));
      return;
    }
    if (req.method === 'PUT' && req.url === '/api/state') {
      puts.push(JSON.parse(body));
      stored = puts[puts.length - 1];
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, revision: stored.meta?.revision || 0 }));
      return;
    }
    res.writeHead(404);
    res.end('missing');
  }, async (baseUrl) => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'sales-hunter-ff-'));
    const hunter = createSalesHunterExecutor({ workspaceRoot, forgeFrontBaseUrl: baseUrl });
    const result = await hunter.huntOutbound({
      offer: 'ForgeFront Solar install consult',
      segment: 'IL homeowners with 250+ electric bills',
      closeDate: '2026-09-30',
      leads: [
        { name: 'Ada Homeowner', fit: 'high', signal: 'bill $310' },
        { name: 'Random Coffee Cart', fit: 'low', signal: 'food truck' },
      ],
    });

    assert.equal(result.sendAuthorized, false);
    assert.equal(result.forgeFrontIngest?.ok, true);
    assert.equal(result.forgeFrontIngest?.mergedLeads >= 1, true);
    assert.equal(puts.length, 1);
    const leads = puts[0].solarSales.leads;
    assert.ok(leads.some((l) => l.leadName === 'Ada Homeowner' && l.source === 'sales_hunter'));
    assert.ok(!leads.some((l) => /coffee/i.test(l.leadName || '')));
    assert.equal(puts[0].solarLeads.length, leads.length);
    assert.ok(Number(puts[0].meta.revision) > 3);
    assert.ok(leads.every((l) => l.sendAuthorized === false));
  });
});

test('roster lock: NYX tip of sword; Sales Hunter tier zero; clusters parked; Ronan deferred', () => {
  const byId = Object.fromEntries(fleetRegistry.agents.map((a) => [a.id, a]));
  assert.equal(byId.nyx.tipOfSword, true);
  assert.equal(byId.sales_hunter.tierZero, true);
  assert.equal(byId.ronan_v01.deferred, true);
  assert.equal(byId.aether_wlm.wlmTarget, true);
  assert.ok(fleetRegistry.clusters.every((c) => c.parked === true && c.enabled === true));
});

test('Sales Hunter Tier Zero approved outreach_send: one lead, outbox + CRM follow-up; spray denied', async () => {
  let stored = { solarSales: { leads: [], sessions: [] }, communications: [], activity: [], meta: { revision: 1 } };
  await withForgeFrontStateStub(async (req, res, body) => {
    if (req.method === 'GET' && req.url === '/api/state') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(stored));
      return;
    }
    if (req.method === 'PUT' && req.url === '/api/state') {
      stored = JSON.parse(body);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, revision: stored.meta?.revision || 0 }));
      return;
    }
    res.writeHead(404);
    res.end('missing');
  }, async (baseUrl) => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'sales-hunter-send-'));
    const hunter = createSalesHunterExecutor({ workspaceRoot, forgeFrontBaseUrl: baseUrl });
    const hunt = await hunter.huntOutbound({
      offer: 'ForgeFront Solar written comparison',
      segment: 'high-bill homeowners',
      closeDate: '2026-10-15',
      leads: [
        { name: 'Ada Homeowner', fit: 'high', signal: 'bill $310' },
        { name: 'Low-fit distractor', fit: 'low', signal: 'unrelated' },
      ],
    });
    const leadId = hunt.drafts[0].leadId;

    await assert.rejects(
      () => hunter.executeApprovedOutreach({ huntId: hunt.artifactPath.split('/').pop().replace(/\.json$/, ''), leadId }),
      /humanApproved/i,
    );
    // huntId from artifactPath sales-hunter/hunt-uuid.json
    const huntId = hunt.artifactPath.replace(/^sales-hunter\//, '').replace(/\.json$/, '');

    await assert.rejects(
      () => hunter.executeApprovedOutreach({
        humanApproved: true,
        huntId,
        leadIds: [leadId, 'lead-2'],
      }),
      /exactly one leadId|spray/i,
    );

    await assert.rejects(
      () => hunter.executeApprovedOutreach({
        humanApproved: true,
        huntId,
        leadId,
        tool: 'phone_call',
      }),
      /phone_call denied/i,
    );

    const sent = await hunter.executeApprovedOutreach({
      humanApproved: true,
      huntId,
      leadId,
    });
    assert.equal(sent.action, 'outreach_send');
    assert.equal(sent.tier, 0);
    assert.equal(sent.sendAuthorized, true);
    assert.equal(sent.transport, 'local_outbox');
    assert.equal(sent.deniedTools.includes('phone_call'), true);
    assert.ok(sent.outboxPath);
    assert.ok(sent.followUpAt);
    assert.equal(sent.forgeFrontSend?.ok, true);

    const outbox = JSON.parse(await readFile(path.join(workspaceRoot, sent.outboxPath), 'utf8'));
    assert.equal(outbox.humanApproved, true);
    assert.equal(outbox.to, 'Ada Homeowner');

    const lead = stored.solarSales.leads.find((l) => l.leadName === 'Ada Homeowner');
    assert.equal(lead.outreachStatus, 'sent');
    assert.equal(lead.stage, 'FOLLOW_UP');
    assert.ok(stored.communications.some((c) => c.direction === 'outbound' && c.to === 'Ada Homeowner'));
  });
});

test('role capability routes outreach_send through approved Sales Hunter path', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'sales-hunter-role-send-'));
  const exec = createRoleCapabilityExecutor({ repositoryRoot: process.cwd(), workspaceRoot });
  const hunt = await exec.execute('outbound-acquisition', {
    agentId: 'sales_hunter',
    offer: 'Mesh install',
    segment: 'CNC shops',
    closeDate: '2026-11-01',
  });
  const huntId = hunt.artifactPath.replace(/^sales-hunter\//, '').replace(/\.json$/, '');
  const leadId = hunt.drafts[0].leadId;
  const sent = await exec.execute('outbound-acquisition', {
    agentId: 'sales_hunter',
    action: 'outreach_send',
    humanApproved: true,
    huntId,
    leadId,
  });
  assert.equal(sent.action, 'outreach_send');
  assert.equal(sent.sendAuthorized, true);
});
