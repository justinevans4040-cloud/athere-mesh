/**
 * Item 14 — typed memory projection over existing mission authority.
 * Not a parallel memory database. Writes remain on mission-state / facts / proof.
 */

export const MEMORY_TYPES = Object.freeze([
  'working',
  'episodic',
  'semantic',
  'procedural',
  'artifact',
  'state_history',
]);

/** Closed reader set — accessPolicy.read is enforced against this. */
export const MEMORY_READERS = Object.freeze([
  'mission-state-service',
  'orchestrator',
  'auditor',
]);

/** Only the mission-state service may own typed-memory writes (there is no write API). */
export const MEMORY_WRITERS = Object.freeze(['mission-state-service']);

export const MEMORY_MAX_SEMANTIC = 256;
export const MEMORY_MAX_ARTIFACT = 64;
export const MEMORY_MAX_EPISODIC = 256;
export const MEMORY_MAX_STATE_HISTORY = 256;

const TYPE_SET = new Set(MEMORY_TYPES);
const READER_SET = new Set(MEMORY_READERS);
const WRITER_SET = new Set(MEMORY_WRITERS);

const CLASSIFY_FIELDS = new Set(['memoryType', 'validationState', 'id', 'role']);

const ROLE_BY_TYPE = Object.freeze({
  working: 'current_state',
  episodic: 'remembered_history',
  semantic: 'learned_knowledge',
  procedural: 'executable_skill',
  artifact: 'artifact_memory',
  state_history: 'state_history',
});

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requiredText(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

export function assertMemoryReader(reader) {
  const id = requiredText(reader, 'memory reader');
  if (!READER_SET.has(id)) throw new Error(`unauthorized memory reader: ${id}`);
  return id;
}

export function authorizeMemoryRead({ reader, entry }) {
  const readerId = assertMemoryReader(reader);
  if (!plainObject(entry) || !plainObject(entry.accessPolicy) || !Array.isArray(entry.accessPolicy.read)) {
    throw new Error('memory entry accessPolicy.read is required');
  }
  if (!entry.accessPolicy.read.includes(readerId)) {
    throw new Error(`memory read denied for reader: ${readerId}`);
  }
  return true;
}

export function authorizeMemoryWrite({ writer }) {
  const id = requiredText(writer, 'memory writer');
  if (!WRITER_SET.has(id)) throw new Error(`unauthorized memory writer: ${id}`);
  return true;
}

function accessPolicy(scope) {
  return Object.freeze({
    read: MEMORY_READERS,
    write: MEMORY_WRITERS,
    scope,
  });
}

function memoryEntry({
  memoryType,
  id,
  content,
  provenance,
  confidence,
  createdAt,
  validationState,
  accessPolicy: policy,
  supersedes = null,
  supersededBy = null,
}) {
  if (!TYPE_SET.has(memoryType)) throw new TypeError(`unknown memory type: ${memoryType}`);
  return Object.freeze({
    memoryType,
    id: requiredText(id, 'memory id'),
    content: structuredClone(content),
    provenance: Object.freeze(structuredClone(provenance)),
    confidence: Number.isFinite(confidence) ? confidence : 0,
    createdAt: requiredText(createdAt, 'memory createdAt'),
    validationState: requiredText(validationState, 'memory validationState'),
    accessPolicy: Object.freeze(structuredClone(policy)),
    supersedes,
    supersededBy,
  });
}

function assertCap(label, items, max) {
  if (!Array.isArray(items)) return;
  if (items.length > max) {
    throw new Error(`memory projection ${label} exceeds cap (${max})`);
  }
}

function redactSemanticFact(fact) {
  return Object.freeze({
    id: fact.id,
    key: fact.key ?? null,
    status: fact.status ?? null,
    supersedes: fact.supersedes ?? null,
    supersededBy: fact.supersededBy ?? null,
    correctedBy: fact.correctedBy ?? null,
    revokedAt: fact.revokedAt ?? null,
    reason: fact.reason ?? null,
    valueRedacted: true,
  });
}

function redactStateHistoryEntry(entry) {
  return Object.freeze({
    transitionId: entry.transitionId ?? null,
    stateVersion: entry.stateVersion ?? null,
    actor: entry.actor ?? null,
    action: entry.action ?? null,
    timestamp: entry.timestamp ?? null,
    transitionResult: entry.transitionResult ?? null,
    changedFields: Object.freeze([...(entry.output?.changedFields ?? Object.keys(entry.changes ?? {}))]),
    envelopesRedacted: true,
  });
}

function redactEpisodicEvent(event) {
  if (event.kind === 'tool_call' && plainObject(event.detail)) {
    return Object.freeze({
      kind: event.kind,
      at: event.at ?? null,
      agentId: event.agentId ?? null,
      detail: Object.freeze({
        tool: event.detail.tool ?? null,
        ok: event.detail.ok === true,
        agentId: event.detail.agentId ?? event.agentId ?? null,
      }),
    });
  }
  return Object.freeze({
    kind: event.kind ?? null,
    at: event.at ?? null,
    agentId: event.agentId ?? null,
    type: event.type ?? null,
    detailRedacted: true,
  });
}

function redactObservation(observation) {
  return Object.freeze({
    source: observation.source ?? null,
    key: observation.key ?? null,
    observedAt: observation.observedAt ?? null,
    valueRedacted: true,
  });
}

export function classifyMemoryEntry(entry) {
  if (!plainObject(entry)) throw new TypeError('memory entry must be an object');
  for (const key of Object.keys(entry)) {
    if (!CLASSIFY_FIELDS.has(key)) throw new Error(`unsupported memory field: ${key}`);
  }
  const memoryType = requiredText(entry.memoryType, 'memoryType');
  if (!TYPE_SET.has(memoryType)) throw new Error(`unknown memory type: ${memoryType}`);
  return Object.freeze({
    memoryType,
    role: ROLE_BY_TYPE[memoryType],
    validationState: entry.validationState === undefined
      ? null
      : requiredText(entry.validationState, 'validationState'),
  });
}

export function assertMemoryKindsDistinct(projected) {
  if (!plainObject(projected)) throw new TypeError('projected memory must be an object');
  for (const type of MEMORY_TYPES) {
    if (!Array.isArray(projected[type])) {
      throw new Error(`projected memory missing type bucket: ${type}`);
    }
    for (const entry of projected[type]) {
      if (entry.memoryType !== type) {
        throw new Error(`memory type mismatch in ${type} bucket`);
      }
    }
  }
  if ((projected.working?.length ?? 0) === 0) {
    throw new Error('working memory (current state) is empty');
  }
  return Object.freeze({
    currentState: 'working',
    rememberedHistory: 'episodic',
    learnedKnowledge: 'semantic',
    executableSkill: 'procedural',
    artifactMemory: 'artifact',
    stateHistory: 'state_history',
  });
}

export function projectMissionMemory(mission, { types = null, reader } = {}) {
  if (!plainObject(mission) || typeof mission.id !== 'string') {
    throw new TypeError('mission is required to project typed memory');
  }
  const readerId = assertMemoryReader(reader);
  const selected = types === null || types === undefined
    ? MEMORY_TYPES
    : Object.freeze((Array.isArray(types) ? types : [types]).map((type) => {
      if (!TYPE_SET.has(type)) throw new Error(`unknown memory type: ${type}`);
      return type;
    }));
  const selectedSet = new Set(selected);
  const createdAt = typeof mission.createdAt === 'string' ? mission.createdAt : '1970-01-01T00:00:00.000Z';
  const updatedAt = typeof mission.updatedAt === 'string' ? mission.updatedAt : createdAt;
  const buckets = Object.fromEntries(MEMORY_TYPES.map((type) => [type, []]));

  if (selectedSet.has('working')) {
    buckets.working.push(memoryEntry({
      memoryType: 'working',
      id: `${mission.id}:working:context`,
      content: Object.freeze({
        objective: mission.objective ?? mission.intent ?? null,
        status: mission.status ?? null,
        completedWork: Object.freeze([...(mission.completedWork ?? [])]),
        pendingWork: Object.freeze([...(mission.pendingWork ?? [])]),
        failedWork: Object.freeze([...(mission.failedWork ?? [])]),
        activeAgents: Object.freeze([...(mission.activeAgents ?? [])]),
        environmentObservations: Object.freeze((mission.environmentObservations ?? []).map(redactObservation)),
        evidenceCount: Array.isArray(mission.evidence) ? mission.evidence.length : 0,
        evidenceRedacted: true,
      }),
      provenance: Object.freeze({ source: 'mission-state', missionId: mission.id, field: 'working-context' }),
      confidence: 1,
      createdAt: updatedAt,
      validationState: mission.status === 'completed' ? 'verified' : 'active',
      accessPolicy: accessPolicy('mission-working'),
    }));
  }

  if (selectedSet.has('semantic')) {
    const facts = mission.authoritativeFacts ?? [];
    assertCap('semantic', facts, MEMORY_MAX_SEMANTIC);
    for (const fact of facts) {
      if (!plainObject(fact) || typeof fact.id !== 'string') continue;
      buckets.semantic.push(memoryEntry({
        memoryType: 'semantic',
        id: `${mission.id}:semantic:${fact.id}`,
        content: redactSemanticFact(fact),
        provenance: Object.freeze({
          source: 'authoritativeFacts',
          missionId: mission.id,
          factId: fact.id,
          key: fact.key ?? null,
        }),
        confidence: fact.status === 'current' ? 1 : fact.status === 'tentative' ? 0.4 : 0.7,
        createdAt: fact.revokedAt ?? updatedAt,
        validationState: fact.status ?? 'unknown',
        accessPolicy: accessPolicy('mission-semantic'),
        supersedes: fact.supersedes ?? null,
        supersededBy: fact.supersededBy ?? fact.correctedBy ?? null,
      }));
    }
  }

  if (selectedSet.has('procedural')) {
    if (mission.currentPlan) {
      buckets.procedural.push(memoryEntry({
        memoryType: 'procedural',
        id: `${mission.id}:procedural:plan`,
        content: structuredClone(mission.currentPlan),
        provenance: Object.freeze({ source: 'currentPlan', missionId: mission.id }),
        confidence: 1,
        createdAt,
        validationState: 'verified_plan',
        accessPolicy: accessPolicy('mission-procedural'),
      }));
    }
    if (mission.workflowGraph) {
      buckets.procedural.push(memoryEntry({
        memoryType: 'procedural',
        id: `${mission.id}:procedural:workflow`,
        content: structuredClone(mission.workflowGraph),
        provenance: Object.freeze({ source: 'workflowGraph', missionId: mission.id }),
        confidence: 1,
        createdAt,
        validationState: 'verified_workflow',
        accessPolicy: accessPolicy('mission-procedural'),
      }));
    }
  }

  if (selectedSet.has('artifact')) {
    const refs = mission.artifactReferences ?? [];
    assertCap('artifact', refs, MEMORY_MAX_ARTIFACT);
    for (const [index, ref] of refs.entries()) {
      if (!plainObject(ref)) continue;
      const id = typeof ref.id === 'string' ? ref.id : `artifact-${index}`;
      buckets.artifact.push(memoryEntry({
        memoryType: 'artifact',
        id: `${mission.id}:artifact:${id}`,
        content: Object.freeze({
          id,
          artifactHash: ref.artifactHash ?? null,
          proofHash: ref.proofHash ?? null,
          verified: ref.verified === true,
          agent: ref.agent ?? null,
          action: ref.action ?? null,
          verifier: ref.verifierResult?.verifier ?? null,
        }),
        provenance: Object.freeze({
          source: 'artifactReferences',
          missionId: mission.id,
          agent: ref.agent ?? null,
          action: ref.action ?? null,
        }),
        confidence: ref.verified === true ? 1 : 0.5,
        createdAt: typeof ref.timestamp === 'string' ? ref.timestamp : updatedAt,
        validationState: ref.verified === true ? 'verified' : 'unverified',
        accessPolicy: accessPolicy('mission-artifact'),
      }));
    }
  }

  if (selectedSet.has('episodic')) {
    const trace = mission.executionTrace ?? [];
    const signals = mission.signals ?? [];
    assertCap('episodic', [...trace, ...signals], MEMORY_MAX_EPISODIC);
    for (const [index, event] of trace.entries()) {
      if (!plainObject(event)) continue;
      buckets.episodic.push(memoryEntry({
        memoryType: 'episodic',
        id: `${mission.id}:episodic:trace-${index}`,
        content: redactEpisodicEvent(event),
        provenance: Object.freeze({
          source: 'executionTrace',
          missionId: mission.id,
          agentId: event.agentId ?? null,
          kind: event.kind ?? null,
        }),
        confidence: 0.9,
        createdAt: typeof event.at === 'string' ? event.at : updatedAt,
        validationState: 'recorded',
        accessPolicy: accessPolicy('mission-episodic'),
      }));
    }
    for (const [index, signal] of signals.entries()) {
      if (!plainObject(signal)) continue;
      buckets.episodic.push(memoryEntry({
        memoryType: 'episodic',
        id: `${mission.id}:episodic:signal-${index}`,
        content: redactEpisodicEvent(signal),
        provenance: Object.freeze({ source: 'signals', missionId: mission.id, type: signal.type ?? null }),
        confidence: 0.85,
        createdAt: typeof signal.at === 'string' ? signal.at : updatedAt,
        validationState: 'recorded',
        accessPolicy: accessPolicy('mission-episodic'),
      }));
    }
  }

  if (selectedSet.has('state_history')) {
    const history = mission.transitionHistory ?? [];
    assertCap('state_history', history, MEMORY_MAX_STATE_HISTORY);
    for (const [index, entry] of history.entries()) {
      if (!plainObject(entry)) continue;
      const id = typeof entry.transitionId === 'string' ? entry.transitionId : `transition-${index}`;
      buckets.state_history.push(memoryEntry({
        memoryType: 'state_history',
        id: `${mission.id}:state_history:${id}`,
        content: redactStateHistoryEntry(entry),
        provenance: Object.freeze({
          source: 'transitionHistory',
          missionId: mission.id,
          actor: entry.actor ?? null,
          action: entry.action ?? null,
        }),
        confidence: 1,
        createdAt: typeof entry.timestamp === 'string' ? entry.timestamp : updatedAt,
        validationState: entry.transitionResult ?? 'committed',
        accessPolicy: accessPolicy('mission-state-history'),
      }));
    }
  }

  const projected = { missionId: mission.id, reader: readerId };
  for (const type of selected) {
    const entries = buckets[type];
    for (const entry of entries) authorizeMemoryRead({ reader: readerId, entry });
    projected[type] = Object.freeze(entries);
  }
  if (selected.length === MEMORY_TYPES.length) {
    assertMemoryKindsDistinct(projected);
  }
  return Object.freeze(projected);
}
