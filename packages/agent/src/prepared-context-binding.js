import {
  prepareContextPackage,
  resolvePreparedContext,
  writePreparedContext,
} from '../../memory/src/prepared-context.js';

function requiredText(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function validateService(service) {
  if (service == null || typeof service !== 'object' || Array.isArray(service)) {
    throw new TypeError('mission service is required');
  }
  for (const method of ['retrieveMemory', 'select', 'verifyHistory']) {
    if (typeof service[method] !== 'function') {
      throw new TypeError(`mission service ${method}() is required`);
    }
  }
}

export function createPreparedContextBinder({ service, root } = {}) {
  validateService(service);
  const contextRoot = requiredText(root, 'prepared-context root');
  const retrievalService = Object.freeze({
    retrieveMemory: (input) => service.retrieveMemory({ ...input, reader: 'orchestrator' }),
    select: (input) => service.select(input),
    verifyHistory: (input) => service.verifyHistory(input),
  });

  return Object.freeze({
    async bind({
      missionId,
      reader,
      query = {},
      limit = 8,
      maxEstimatedTokens = 4096,
    } = {}) {
      const mission = requiredText(missionId, 'missionId');
      const requestedReader = requiredText(reader, 'reader');
      const prepared = await prepareContextPackage({
        service: retrievalService,
        missionId: mission,
        reader: requestedReader,
        query,
        limit,
        maxEstimatedTokens,
      });

      await writePreparedContext({ root: contextRoot, contextPackage: prepared });
      const resolved = await resolvePreparedContext({
        root: contextRoot,
        handle: prepared.handle,
        service,
        reader: requestedReader,
      });

      return Object.freeze({
        handle: resolved.handle,
        integritySha256: resolved.integrity.sha256,
        missionId: resolved.mission.id,
        stateVersion: resolved.mission.stateVersion,
        stateHash: resolved.mission.stateHash,
        reader: resolved.reader,
        context: resolved.context,
        stats: resolved.stats,
      });
    },
  });
}
