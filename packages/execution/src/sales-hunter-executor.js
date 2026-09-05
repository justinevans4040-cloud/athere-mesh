/**
 * Sales Hunter — Tier Zero outbound acquisition.
 * Drafts + pipeline only. Never sends. Founder profile + wake config doctrine.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { screenAgentOutput } from '../../contracts/src/authority-chain.js';

const DENIED_TOOLS = Object.freeze(['outreach_send', 'phone_call']);
const STAGES = Object.freeze(['identified', 'qualified', 'disqualified', 'drafted']);

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
    '— Sales Hunter / Athere Mesh',
  ].join('\n');
  return { leadId: lead.id, channel: 'email_or_linkedin', cta, body };
}

export function createSalesHunterExecutor({ workspaceRoot } = {}) {
  if (typeof workspaceRoot !== 'string' || workspaceRoot.trim().length === 0) {
    throw new TypeError('workspaceRoot is required');
  }
  const root = path.resolve(workspaceRoot);

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
      handshake: 'Sales Hunter online. Give offer, target segment, and close date.',
      primeDirective: 'Create qualified pipeline and close the next highest-value deal.',
      brief: Object.freeze({ offer, segment, closeDate, location }),
      pipeline: Object.freeze(pipeline.map((row) => Object.freeze(row))),
      drafts: Object.freeze(drafts.map((row) => Object.freeze(row))),
      stages: STAGES,
      sendAuthorized: false,
      deniedTools: DENIED_TOOLS,
      artifactPath: artifactRel.replace(/\\/g, '/'),
      operatingRules: Object.freeze([
        'Always tie outreach to a clear business result.',
        'Prefer short outbound messages with one CTA.',
        'Follow up on schedule until resolved.',
        'Track lead stage transitions explicitly.',
        'Disqualify low-fit leads quickly.',
        'Drafts only — outreach_send and phone_call denied until human approval.',
      ]),
    };
    result.proofSha256 = sha256Json(result);

    await writeFile(artifactAbs, `${JSON.stringify({ ...result, writtenAt: new Date().toISOString() }, null, 2)}\n`, 'utf8');
    return Object.freeze(result);
  }

  return Object.freeze({ huntOutbound });
}
