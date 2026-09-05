/**
 * Sales Hunter — Tier Zero (highest roster class) outbound acquisition.
 * Capability ladder under Zero: pipeline/drafts → human-approved send + follow-up.
 * Phone stays denied. No spray-and-pray.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { screenAgentOutput } from '../../contracts/src/authority-chain.js';

const PHONE_DENIED = Object.freeze(['phone_call']);
const DRAFT_DENIED = Object.freeze(['outreach_send', 'phone_call']);
const STAGES = Object.freeze([
  'identified',
  'qualified',
  'disqualified',
  'drafted',
  'approved',
  'sent',
  'follow_up',
]);

function sha256Json(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function requiredText(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} is required`);
  }
  return value.trim();
}

function parseFromText(text = '') {
  const raw = String(text);
  const offer = /offer\s*[:\-]\s*(.+?)(?:\n|$)/i.exec(raw)?.[1]?.trim();
  const segment = /segment\s*[:\-]\s*(.+?)(?:\n|$)/i.exec(raw)?.[1]?.trim()
    || /target(?:\s+segment)?\s*[:\-]\s*(.+?)(?:\n|$)/i.exec(raw)?.[1]?.trim();
  const closeDate = /close(?:\s*date)?\s*[:\-]\s*(\S+)/i.exec(raw)?.[1]?.trim();
  const location = /location\s*[:\-]\s*(.+?)(?:\n|$)/i.exec(raw)?.[1]?.trim();
  return { offer, segment, closeDate, location };
}

function normalizeLead(entry, index) {
  if (typeof entry === 'string') {
    return { id: `lead-${index + 1}`, name: entry.trim(), fit: 'unknown', signal: '' };
  }
  if (!entry || typeof entry !== 'object') {
    throw new TypeError('lead entries must be strings or objects');
  }
  const name = requiredText(entry.name || entry.company || entry.id, 'lead.name');
  const fit = String(entry.fit || entry.score || 'unknown').toLowerCase();
  return {
    id: String(entry.id || `lead-${index + 1}`),
    name,
    fit,
    signal: typeof entry.signal === 'string' ? entry.signal : '',
  };
}

function qualify(lead) {
  const low = lead.fit === 'low' || lead.fit === 'poor' || /coffee|food truck|unrelated/i.test(`${lead.name} ${lead.signal}`);
  if (low) {
    return {
      ...lead,
      stage: 'disqualified',
      disqualified: true,
      reason: 'low-fit — Sales Hunter disqualifies quickly (no spray-and-pray)',
    };
  }
  const high = lead.fit === 'high' || lead.fit === 'strong' || lead.signal.trim().length > 0;
  return {
    ...lead,
    stage: high ? 'qualified' : 'identified',
    disqualified: false,
    reason: high ? 'signal-backed fit' : 'needs more signal before draft',
  };
}

function draftMessage({ offer, lead, closeDate }) {
  const cta = `Can we book 20 minutes before ${closeDate} to see if this fits?`;
  const body = [
    `Hi ${lead.name.split(/\s+/)[0]},`,
    '',
    `Quick note on ${offer}.`,
    lead.signal ? `Saw: ${lead.signal}.` : 'Focused on shops that need local, offline-first ops — not another cloud leash.',
    '',
    cta,
    '',
    '— Sales Hunter / ForgeFront Systems',
  ].join('\n');
  return { leadId: lead.id, channel: 'email_or_linkedin', cta, body };
}

function followUpIso(closeDate) {
  const parsed = Date.parse(closeDate);
  if (Number.isFinite(parsed)) {
    const d = new Date(parsed);
    d.setUTCDate(d.getUTCDate() - 3);
    return d.toISOString();
  }
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 3);
  return d.toISOString();
}

function toForgeFrontLead({ lead, brief, draft, huntId, sendMeta = null }) {
  const sent = sendMeta != null;
  return {
    id: `sh_${lead.id}`,
    leadName: lead.name,
    source: 'sales_hunter',
    hunterStage: lead.stage,
    stage: sent ? 'FOLLOW_UP' : (lead.stage === 'drafted' || lead.stage === 'approved' ? 'QUALIFY' : 'OPEN'),
    signal: lead.signal || '',
    fit: lead.fit || 'unknown',
    offer: brief.offer,
    segment: brief.segment,
    closeDate: brief.closeDate,
    location: brief.location || '',
    huntId,
    draftCta: draft?.cta || '',
    draftBody: draft?.body || '',
    sendAuthorized: sent ? true : false,
    outreachStatus: sent ? 'sent' : 'draft',
    followUpAt: sent ? sendMeta.followUpAt : null,
    lastOutreachAt: sent ? sendMeta.sentAt : null,
    outboxPath: sent ? sendMeta.outboxPath : null,
    updatedAt: new Date().toISOString(),
  };
}

async function readForgeFrontState(baseUrl, fetchImpl) {
  const root = String(baseUrl).replace(/\/+$/, '');
  const stateUrl = `${root}/api/state`;
  const getRes = await fetchImpl(stateUrl, { method: 'GET', headers: { accept: 'application/json' } });
  if (!getRes.ok) throw new Error(`ForgeFront state GET failed: ${getRes.status}`);
  const state = await getRes.json();
  if (!state || typeof state !== 'object') throw new TypeError('ForgeFront state must be an object');
  state.solarSales ||= { leads: [], sessions: [] };
  state.solarSales.leads = Array.isArray(state.solarSales.leads) ? state.solarSales.leads : [];
  state.solarSales.sessions = Array.isArray(state.solarSales.sessions) ? state.solarSales.sessions : [];
  state.solarLeads = Array.isArray(state.solarLeads) ? state.solarLeads : state.solarSales.leads;
  state.solarCalls = Array.isArray(state.solarCalls) ? state.solarCalls : state.solarSales.sessions;
  state.communications = Array.isArray(state.communications) ? state.communications : [];
  state.activity = Array.isArray(state.activity) ? state.activity : [];
  state.solarDnc ||= [];
  state.solarConfig ||= {};
  state.meta ||= {};
  return { root, stateUrl, state };
}

async function writeForgeFrontState(stateUrl, state, fetchImpl) {
  state.solarLeads = state.solarSales.leads;
  state.solarCalls = state.solarSales.sessions;
  state.meta.revision = Number(state.meta.revision || 0) + 1;
  state.meta.updatedAt = new Date().toISOString();
  const putRes = await fetchImpl(stateUrl, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(state),
  });
  if (!putRes.ok) throw new Error(`ForgeFront state PUT failed: ${putRes.status}`);
  return state.meta.revision;
}

async function mergePipelineIntoForgeFrontState({
  baseUrl,
  huntId,
  brief,
  pipeline,
  drafts,
  fetchImpl = globalThis.fetch,
}) {
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('fetchImpl is required for ForgeFront ingest');
  }
  const { root, stateUrl, state } = await readForgeFrontState(baseUrl, fetchImpl);
  const draftByLead = new Map((drafts || []).map((d) => [d.leadId, d]));
  const keep = pipeline.filter((lead) => lead.disqualified !== true);
  let mergedLeads = 0;
  for (const lead of keep) {
    const row = toForgeFrontLead({
      lead,
      brief,
      draft: draftByLead.get(lead.id),
      huntId,
    });
    const idx = state.solarSales.leads.findIndex((x) => x.id === row.id || (x.source === 'sales_hunter' && x.leadName === row.leadName));
    if (idx >= 0) state.solarSales.leads[idx] = { ...state.solarSales.leads[idx], ...row };
    else state.solarSales.leads.unshift(row);
    mergedLeads += 1;
  }
  state.meta.lastSalesHunterHuntId = huntId;
  const revision = await writeForgeFrontState(stateUrl, state, fetchImpl);
  return Object.freeze({
    ok: true,
    baseUrl: root,
    mergedLeads,
    revision,
    sendAuthorized: false,
  });
}

async function patchForgeFrontAfterSend({
  baseUrl,
  lead,
  brief,
  draft,
  huntId,
  sendMeta,
  fetchImpl,
}) {
  const { root, stateUrl, state } = await readForgeFrontState(baseUrl, fetchImpl);
  const row = toForgeFrontLead({ lead, brief, draft, huntId, sendMeta });
  const idx = state.solarSales.leads.findIndex((x) => x.id === row.id || (x.source === 'sales_hunter' && x.leadName === row.leadName));
  if (idx >= 0) state.solarSales.leads[idx] = { ...state.solarSales.leads[idx], ...row };
  else state.solarSales.leads.unshift(row);

  const rec = {
    id: `cm_${randomUUID().slice(0, 12)}`,
    projectId: '',
    contactId: row.id,
    channel: draft.channel || 'email_or_linkedin',
    direction: 'outbound',
    to: lead.name,
    from: 'Sales Hunter / ForgeFront Systems',
    subject: `Outreach: ${brief.offer}`,
    body: draft.body,
    status: 'QueuedLocalOutbox',
    time: sendMeta.sentAt,
    huntId,
    followUpAt: sendMeta.followUpAt,
  };
  state.communications.unshift(rec);
  state.activity.unshift({
    id: `ev_${randomUUID().slice(0, 12)}`,
    projectId: '',
    kind: 'outreach_send',
    message: `Sales Hunter sent outreach to ${lead.name}`,
    time: sendMeta.sentAt,
    actor: 'sales_hunter',
  });
  state.meta.lastSalesHunterSendId = sendMeta.sendId;
  const revision = await writeForgeFrontState(stateUrl, state, fetchImpl);
  return Object.freeze({ ok: true, baseUrl: root, revision, communicationId: rec.id });
}

export function createSalesHunterExecutor({ workspaceRoot, forgeFrontBaseUrl = null, fetchImpl = globalThis.fetch } = {}) {
  if (typeof workspaceRoot !== 'string' || workspaceRoot.trim().length === 0) {
    throw new TypeError('workspaceRoot is required');
  }
  const root = path.resolve(workspaceRoot);
  const defaultForgeFrontBaseUrl = typeof forgeFrontBaseUrl === 'string' && forgeFrontBaseUrl.trim()
    ? forgeFrontBaseUrl.trim().replace(/\/+$/, '')
    : null;

  async function huntOutbound(input = {}) {
    const fromText = parseFromText(input.text);
    const offer = requiredText(input.offer ?? fromText.offer, 'offer');
    const segment = requiredText(input.segment ?? fromText.segment, 'segment');
    const closeDate = requiredText(input.closeDate ?? input.close_date ?? fromText.closeDate, 'close date');
    const location = (input.location ?? fromText.location ?? '').toString().trim() || null;

    const seedLeads = Array.isArray(input.leads) && input.leads.length > 0
      ? input.leads
      : [
        { name: `${segment} — primary ICP target`, fit: 'high', signal: location ? `geo:${location}` : 'segment match' },
        { name: `${segment} — secondary ICP target`, fit: 'high', signal: `close window ${closeDate}` },
        { name: 'Low-fit distractor', fit: 'low', signal: 'unrelated' },
      ];

    const pipeline = seedLeads.map((entry, index) => qualify(normalizeLead(entry, index)));
    const qualified = pipeline.filter((lead) => lead.disqualified !== true && lead.stage !== 'identified');
    const drafts = [];
    for (const lead of qualified) {
      const draft = draftMessage({ offer, lead, closeDate });
      const screened = screenAgentOutput({ output: draft.body, agentId: 'sales_hunter' });
      if (screened.safe !== true || screened.cleared !== true) {
        throw new Error(`Sales Hunter draft blocked by QRA Sentinel: ${screened.feedback}`);
      }
      drafts.push({
        ...draft,
        stage: 'drafted',
        screened: Object.freeze({
          safe: screened.safe,
          cleared: screened.cleared,
          riskLevel: screened.riskLevel,
        }),
      });
      lead.stage = 'drafted';
    }

    const huntId = `hunt-${randomUUID()}`;
    const artifactRel = path.join('sales-hunter', `${huntId}.json`);
    const artifactAbs = path.join(root, artifactRel);
    await mkdir(path.dirname(artifactAbs), { recursive: true });

    const result = {
      capabilityId: 'outbound-acquisition',
      action: 'hunt_outbound',
      agentId: 'sales_hunter',
      tier: 0,
      decision: 'PIPELINE_READY',
      handshake: 'Sales Hunter online. Give offer, target segment, and close date. Approve one lead to send.',
      primeDirective: 'Create qualified pipeline and close the next highest-value deal.',
      brief: Object.freeze({ offer, segment, closeDate, location }),
      pipeline: Object.freeze(pipeline.map((row) => Object.freeze(row))),
      drafts: Object.freeze(drafts.map((row) => Object.freeze(row))),
      stages: STAGES,
      sendAuthorized: false,
      deniedTools: DRAFT_DENIED,
      artifactPath: artifactRel.replace(/\\/g, '/'),
      operatingRules: Object.freeze([
        'Always tie outreach to a clear business result.',
        'Prefer short outbound messages with one CTA.',
        'Follow up on schedule until resolved.',
        'Track lead stage transitions explicitly.',
        'Disqualify low-fit leads quickly.',
        'Human approval required per outreach_send — one lead at a time. phone_call denied.',
      ]),
    };
    const targetForgeFront = (typeof input.forgeFrontBaseUrl === 'string' && input.forgeFrontBaseUrl.trim())
      ? input.forgeFrontBaseUrl.trim().replace(/\/+$/, '')
      : defaultForgeFrontBaseUrl;

    if (targetForgeFront) {
      result.forgeFrontIngest = await mergePipelineIntoForgeFrontState({
        baseUrl: targetForgeFront,
        huntId,
        brief: result.brief,
        pipeline,
        drafts,
        fetchImpl,
      });
    }

    result.proofSha256 = sha256Json(result);
    await writeFile(artifactAbs, `${JSON.stringify({ ...result, writtenAt: new Date().toISOString() }, null, 2)}\n`, 'utf8');
    return Object.freeze(result);
  }

  /**
   * Next capability under Tier Zero: human-approved outreach_send for exactly one lead.
   * Writes local outbox (offline-first send artifact) + advances ForgeFront CRM to FOLLOW_UP.
   */
  async function executeApprovedOutreach(input = {}) {
    if (input.humanApproved !== true && input.human_approved !== true) {
      throw new Error('outreach_send denied — humanApproved:true required (Sales Hunter Tier Zero)');
    }
    if (input.channel === 'phone' || input.tool === 'phone_call') {
      throw new Error('phone_call denied — Sales Hunter Tier Zero keeps voice gated');
    }
    const leadIds = [];
    if (typeof input.leadId === 'string' && input.leadId.trim()) leadIds.push(input.leadId.trim());
    if (Array.isArray(input.leadIds)) {
      for (const id of input.leadIds) {
        if (typeof id === 'string' && id.trim()) leadIds.push(id.trim());
      }
    }
    const unique = [...new Set(leadIds)];
    if (unique.length !== 1) {
      throw new Error('outreach_send denied — approve exactly one leadId (no spray-and-pray)');
    }
    const leadId = unique[0];
    const huntId = requiredText(input.huntId || input.hunt_id, 'huntId');
    const artifactRel = path.join('sales-hunter', `${huntId}.json`);
    const artifactAbs = path.join(root, artifactRel);
    let hunt;
    try {
      hunt = JSON.parse(await readFile(artifactAbs, 'utf8'));
    } catch {
      throw new Error(`hunt artifact not found: ${artifactRel.replace(/\\/g, '/')}`);
    }
    if (hunt.agentId !== 'sales_hunter' || hunt.tier !== 0) {
      throw new Error('invalid Sales Hunter hunt artifact');
    }

    const draft = (hunt.drafts || []).find((d) => d.leadId === leadId);
    if (!draft) throw new Error(`no drafted message for leadId ${leadId}`);
    const lead = (hunt.pipeline || []).find((p) => p.id === leadId);
    if (!lead || lead.disqualified === true) throw new Error(`lead ${leadId} is not sendable`);

    const screened = screenAgentOutput({ output: draft.body, agentId: 'sales_hunter' });
    if (screened.safe !== true || screened.cleared !== true) {
      throw new Error(`Sales Hunter send blocked by QRA Sentinel: ${screened.feedback}`);
    }

    const sendId = `send-${randomUUID()}`;
    const sentAt = new Date().toISOString();
    const followUpAt = followUpIso(hunt.brief?.closeDate);
    const outboxRel = path.join('sales-hunter', 'outbox', `${sendId}.json`);
    const outboxAbs = path.join(root, outboxRel);
    await mkdir(path.dirname(outboxAbs), { recursive: true });

    const leadAfter = { ...lead, stage: 'sent' };
    const sendMeta = {
      sendId,
      sentAt,
      followUpAt,
      outboxPath: outboxRel.replace(/\\/g, '/'),
    };

    const outbox = {
      sendId,
      huntId,
      leadId,
      agentId: 'sales_hunter',
      tier: 0,
      action: 'outreach_send',
      channel: draft.channel,
      to: lead.name,
      body: draft.body,
      cta: draft.cta,
      brief: hunt.brief,
      humanApproved: true,
      transport: 'local_outbox',
      sentAt,
      followUpAt,
      screened: Object.freeze({
        safe: screened.safe,
        cleared: screened.cleared,
        riskLevel: screened.riskLevel,
      }),
      deniedTools: PHONE_DENIED,
    };
    outbox.proofSha256 = sha256Json(outbox);
    await writeFile(outboxAbs, `${JSON.stringify(outbox, null, 2)}\n`, 'utf8');

    const targetForgeFront = (typeof input.forgeFrontBaseUrl === 'string' && input.forgeFrontBaseUrl.trim())
      ? input.forgeFrontBaseUrl.trim().replace(/\/+$/, '')
      : defaultForgeFrontBaseUrl;

    let forgeFrontSend = null;
    if (targetForgeFront) {
      forgeFrontSend = await patchForgeFrontAfterSend({
        baseUrl: targetForgeFront,
        lead: leadAfter,
        brief: hunt.brief,
        draft,
        huntId,
        sendMeta,
        fetchImpl,
      });
    }

    const result = {
      capabilityId: 'outbound-acquisition',
      action: 'outreach_send',
      agentId: 'sales_hunter',
      tier: 0,
      decision: 'OUTREACH_QUEUED',
      sendAuthorized: true,
      humanApproved: true,
      leadId,
      huntId,
      sendId,
      followUpAt,
      outboxPath: outboxRel.replace(/\\/g, '/'),
      transport: 'local_outbox',
      deniedTools: PHONE_DENIED,
      screened: outbox.screened,
      forgeFrontSend,
      note: 'Tier Zero next capability: human-approved send via local outbox + CRM follow-up. External SMTP/API not claimed.',
    };
    result.proofSha256 = sha256Json(result);

    const sendArtifactRel = path.join('sales-hunter', `${sendId}.json`);
    await writeFile(path.join(root, sendArtifactRel), `${JSON.stringify({ ...result, writtenAt: sentAt }, null, 2)}\n`, 'utf8');
    result.artifactPath = sendArtifactRel.replace(/\\/g, '/');
    return Object.freeze(result);
  }

  return Object.freeze({ huntOutbound, executeApprovedOutreach });
}
