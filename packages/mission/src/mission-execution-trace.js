/**
 * Item 13 — machine-readable mission execution traces.
 * Extends the existing mission ledger; does not replace transitionHistory.
 */

export const TRACE_SCHEMA_VERSION = 1;

export const TRACE_KINDS = Object.freeze([
  'state_change',
  'agent',
  'model',
  'input_contract',
  'tool_call',
  'verifier_decision',
  'evidence',
  'latency',
  'token_usage',
  'cost',
  'retry',
  'failure',
  'rollback',
]);

/** Hard caps for caller-supplied observability (Item 13 security close). */
export const OBSERVABILITY_MAX_TOOL_CALLS = 8;
export const OBSERVABILITY_MAX_MODELS = 8;
export const OBSERVABILITY_MAX_BYTES = 8_192;

const KIND_SET = new Set(TRACE_KINDS);
const OBSERVABILITY_KEYS = new Set(['toolCalls', 'latencyMs', 'models', 'tokenUsage', 'costUsd']);

function requiredText(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function createTraceEvent({
  kind,
  at,
  agentId = null,
  detail = null,
  metrics = null,
  refs = null,
}) {
  if (!KIND_SET.has(kind)) throw new TypeError(`unsupported trace kind: ${kind}`);
  const event = {
    kind,
    at: requiredText(at, 'trace event at'),
    agentId: agentId === null || agentId === undefined ? null : requiredText(agentId, 'trace agentId'),
    detail: detail === null || detail === undefined ? null : structuredClone(detail),
    metrics: metrics === null || metrics === undefined ? null : Object.freeze(structuredClone(metrics)),
    refs: refs === null || refs === undefined ? null : Object.freeze(structuredClone(refs)),
  };
  return Object.freeze(event);
}

export function appendTraceEvents(existingTrace = [], events = []) {
  if (!Array.isArray(existingTrace)) throw new TypeError('executionTrace must be an array');
  if (!Array.isArray(events)) throw new TypeError('trace events must be an array');
  return Object.freeze([...existingTrace, ...events.map((event) => Object.freeze(structuredClone(event)))]);
}

function signalFromInput(input) {
  return plainObject(input?.signal) ? input.signal : null;
}

function envelopeFromInput(input) {
  return plainObject(input?.envelope) ? input.envelope : null;
}

function qr18FromInput(input) {
  const signal = signalFromInput(input);
  const result = plainObject(signal?.result) ? signal.result : null;
  if (plainObject(result?.qr18)) return result.qr18;
  if (plainObject(result?.auditorVerification)) return result.auditorVerification;
  return null;
}

export function eventsFromTransition(lineage, observability = null) {
  if (!plainObject(lineage)) throw new TypeError('transition lineage must be an object');
  const at = requiredText(lineage.timestamp ?? lineage.at ?? new Date(0).toISOString(), 'transition timestamp');
  const actor = typeof lineage.actor === 'string' ? lineage.actor : null;
  const action = typeof lineage.action === 'string' ? lineage.action : null;
  const status = lineage.output?.status ?? signalFromInput(lineage.input)?.type ?? null;
  const events = [];

  events.push(createTraceEvent({
    kind: 'state_change',
    at,
    agentId: actor,
    detail: Object.freeze({
      action,
      status,
      stateVersion: lineage.stateVersion ?? null,
      transitionId: lineage.transitionId ?? null,
      changedFields: Object.freeze([...(lineage.output?.changedFields ?? Object.keys(lineage.changes ?? {}))]),
      changes: lineage.changes === undefined ? null : structuredClone(lineage.changes),
    }),
    refs: Object.freeze({
      operationId: lineage.operationId ?? null,
      transitionHash: lineage.transitionHash ?? null,
    }),
  }));

  if (actor) {
    events.push(createTraceEvent({
      kind: 'agent',
      at,
      agentId: actor,
      detail: Object.freeze({ action, status }),
    }));
  }

  const envelope = envelopeFromInput(lineage.input);
  if (envelope) {
    events.push(createTraceEvent({
      kind: 'input_contract',
      at,
      agentId: typeof envelope.agent_id === 'string' ? envelope.agent_id : actor,
      detail: Object.freeze({
        objective: envelope.objective ?? null,
        allowed_actions: Object.freeze([...(envelope.allowed_actions ?? [])]),
        required_inputs: Object.freeze([...(envelope.required_inputs ?? [])]),
        evidence_requirements: Object.freeze([...(envelope.evidence_requirements ?? [])]),
        timeout: envelope.timeout ?? null,
        resource_budget: envelope.resource_budget ?? null,
      }),
    }));
  }

  if (lineage.evidence !== null && lineage.evidence !== undefined) {
    events.push(createTraceEvent({
      kind: 'evidence',
      at,
      agentId: actor,
      detail: structuredClone(lineage.evidence),
    }));
  }

  const verifier = qr18FromInput(lineage.input);
  if (verifier) {
    events.push(createTraceEvent({
      kind: 'verifier_decision',
      at,
      agentId: actor,
      detail: structuredClone(verifier),
    }));
  }

  const signal = signalFromInput(lineage.input);
  if (signal?.type === 'blocked' || status === 'blocked' || action === 'block_interrupted_mission') {
    events.push(createTraceEvent({
      kind: 'failure',
      at,
      agentId: actor,
      detail: Object.freeze({
        reason: signal?.detail ?? action ?? 'mission blocked',
        status: 'blocked',
        failedWork: structuredClone(lineage.input?.update?.failedWork ?? null),
      }),
    }));
  }

  if (action === 'rollback_to_checkpoint') {
    events.push(createTraceEvent({
      kind: 'rollback',
      at,
      agentId: actor,
      detail: structuredClone(lineage.input ?? { action }),
    }));
  }

  if (action === 'retry_from_checkpoint') {
    events.push(createTraceEvent({
      kind: 'retry',
      at,
      agentId: actor,
      detail: structuredClone(lineage.input ?? { action }),
    }));
  }

  if (observability !== null && observability !== undefined) {
    if (!plainObject(observability)) throw new TypeError('observability must be an object');
    for (const key of Object.keys(observability)) {
      if (!OBSERVABILITY_KEYS.has(key)) {
        throw new Error(`unsupported observability field: ${key}`);
      }
    }
    const encoded = JSON.stringify(observability);
    if (encoded.length > OBSERVABILITY_MAX_BYTES) {
      throw new Error(`observability payload exceeds size cap (${OBSERVABILITY_MAX_BYTES} bytes)`);
    }
    if (Array.isArray(observability.toolCalls)) {
      if (observability.toolCalls.length > OBSERVABILITY_MAX_TOOL_CALLS) {
        throw new Error(`observability toolCalls exceed cap (${OBSERVABILITY_MAX_TOOL_CALLS})`);
      }
      for (const call of observability.toolCalls) {
        if (!plainObject(call)) throw new TypeError('observability toolCalls entry must be an object');
        if (typeof call.agentId === 'string') {
          const claimed = call.agentId.trim().toLowerCase();
          const authorized = typeof actor === 'string' ? actor.trim().toLowerCase() : '';
          if (claimed !== authorized) {
            throw new Error('tool_call agentId must match authorized actor');
          }
        }
        const bound = Object.freeze({
          ...structuredClone(call),
          agentId: actor,
        });
        events.push(createTraceEvent({
          kind: 'tool_call',
          at,
          agentId: actor,
          detail: bound,
        }));
      }
    }
    if (Number.isFinite(observability.latencyMs)) {
      events.push(createTraceEvent({
        kind: 'latency',
        at,
        agentId: actor,
        metrics: Object.freeze({ latencyMs: observability.latencyMs }),
      }));
    }
    if (Array.isArray(observability.models)) {
      if (observability.models.length > OBSERVABILITY_MAX_MODELS) {
        throw new Error(`observability models exceed cap (${OBSERVABILITY_MAX_MODELS})`);
      }
      for (const model of observability.models) {
        events.push(createTraceEvent({
          kind: 'model',
          at,
          agentId: actor,
          detail: Object.freeze(structuredClone(model)),
        }));
      }
    }
    if (observability.tokenUsage !== undefined) {
      events.push(createTraceEvent({
        kind: 'token_usage',
        at,
        agentId: actor,
        metrics: Object.freeze({ tokenUsage: observability.tokenUsage }),
      }));
    }
    if (observability.costUsd !== undefined) {
      events.push(createTraceEvent({
        kind: 'cost',
        at,
        agentId: actor,
        metrics: Object.freeze({ costUsd: observability.costUsd }),
      }));
    }
  }

  return Object.freeze(events);
}

function collect(trace, kind) {
  return Object.freeze(trace.filter((event) => event.kind === kind));
}

export function buildExecutionTrace(mission) {
  if (!plainObject(mission) || typeof mission.id !== 'string') {
    throw new TypeError('mission is required to build an execution trace');
  }
  const timeline = Object.freeze(structuredClone(mission.executionTrace ?? []));
  const agents = Object.freeze([...new Set(
    timeline.filter((event) => typeof event.agentId === 'string').map((event) => event.agentId),
  )].sort());
  const latencyMs = Object.freeze(
    collect(timeline, 'latency')
      .map((event) => event.metrics?.latencyMs)
      .filter((value) => Number.isFinite(value)),
  );
  const tokenUsage = Object.freeze(
    collect(timeline, 'token_usage')
      .map((event) => event.metrics?.tokenUsage)
      .filter((value) => value !== undefined),
  );
  const costUsd = Object.freeze(
    collect(timeline, 'cost')
      .map((event) => event.metrics?.costUsd)
      .filter((value) => value !== undefined),
  );

  return Object.freeze({
    schemaVersion: TRACE_SCHEMA_VERSION,
    missionId: mission.id,
    status: mission.status ?? null,
    objective: mission.objective ?? mission.intent ?? null,
    timeline,
    agents,
    models: collect(timeline, 'model').map((event) => event.detail),
    inputContracts: collect(timeline, 'input_contract').map((event) => event.detail),
    toolCalls: collect(timeline, 'tool_call').map((event) => event.detail),
    verifierDecisions: collect(timeline, 'verifier_decision').map((event) => event.detail),
    evidence: collect(timeline, 'evidence').map((event) => event.detail),
    stateChanges: collect(timeline, 'state_change').map((event) => event.detail),
    failures: collect(timeline, 'failure').map((event) => event.detail),
    retries: collect(timeline, 'retry').map((event) => event.detail),
    rollbacks: collect(timeline, 'rollback').map((event) => event.detail),
    metrics: Object.freeze({ latencyMs, tokenUsage, costUsd }),
    transitionCount: Array.isArray(mission.transitionHistory) ? mission.transitionHistory.length : 0,
  });
}

export function reconstructFailedMission(mission) {
  if (!plainObject(mission) || typeof mission.id !== 'string') {
    throw new TypeError('mission is required to reconstruct execution');
  }
  const history = Array.isArray(mission.transitionHistory) ? mission.transitionHistory : [];
  const trace = Array.isArray(mission.executionTrace) ? mission.executionTrace : [];
  if (history.length === 0 && trace.length === 0) {
    throw new Error(`cannot reconstruct mission ${mission.id}: durable execution history is missing`);
  }
  return buildExecutionTrace(mission);
}

export function withAppendedTrace(mission, lineage, observability = null) {
  const events = eventsFromTransition(lineage, observability);
  return Object.freeze({
    ...mission,
    executionTrace: appendTraceEvents(mission.executionTrace ?? [], events),
  });
}
