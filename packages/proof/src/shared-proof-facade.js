import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  writeProof as writeProofFs,
  verifyProof as verifyProofFs,
  writeArtifactProof as writeArtifactProofFs,
  verifyArtifactProof as verifyArtifactProofFs,
} from '../../proof/src/proof-store.js';

/**
 * Dual-write facade: FS remains local cache; shared Postgres is authoritative for
 * cross-host verify. Offline default (no shared) keeps FS-only behaviour.
 */
export function createSharedProofFacade({ sharedProofStore = null } = {}) {
  if (sharedProofStore != null) {
    if (typeof sharedProofStore.put !== 'function' || typeof sharedProofStore.get !== 'function') {
      throw new TypeError('sharedProofStore must provide put and get');
    }
  }

  async function mirrorPut({ root, relativePath, sha256, operationId, kind }) {
    if (sharedProofStore == null) return;
    const absolute = path.resolve(root, ...relativePath.split('/'));
    const content = await readFile(absolute, 'utf8');
    await sharedProofStore.put({
      path: relativePath,
      content,
      sha256,
      operationId,
      kind,
    });
  }

  return Object.freeze({
    async writeProof(args) {
      const ref = await writeProofFs(args);
      await mirrorPut({
        root: args.root,
        relativePath: ref.path,
        sha256: ref.sha256,
        operationId: ref.operationId,
        kind: 'mission',
      });
      return ref;
    },

    async verifyProof(args) {
      if (sharedProofStore != null) {
        const row = await sharedProofStore.get({ path: args.ref.path });
        if (row != null) {
          if (row.sha256 !== args.ref.sha256) {
            return { verified: false, sha256: args.ref.sha256, reason: 'hash_mismatch' };
          }
          let record;
          try {
            record = JSON.parse(row.content);
          } catch {
            return { verified: false, sha256: args.ref.sha256, reason: 'invalid_proof_record' };
          }
          if (record.operationId !== args.ref.operationId || !Object.hasOwn(record, 'payload')) {
            return { verified: false, sha256: args.ref.sha256, reason: 'proof_binding_mismatch' };
          }
          return { verified: true, sha256: row.sha256, source: 'shared-postgres' };
        }
      }
      return verifyProofFs(args);
    },

    async writeArtifactProof(args) {
      const ref = await writeArtifactProofFs(args);
      await mirrorPut({
        root: args.root,
        relativePath: ref.path,
        sha256: ref.proofHash,
        operationId: ref.operationId,
        kind: 'artifact',
      });
      return ref;
    },

    async verifyArtifactProof(args) {
      if (sharedProofStore != null) {
        const row = await sharedProofStore.get({ path: args.ref.path });
        if (row != null) {
          // Fall through to FS verifier when local bytes available; shared row
          // proves the proof record exists cross-host even if FS is empty.
          try {
            return await verifyArtifactProofFs(args);
          } catch {
            if (row.sha256 !== args.ref.proofHash) {
              return { verified: false, artifactId: args.ref.artifactId, artifactHash: args.ref.artifactHash, reason: 'proof_hash_mismatch' };
            }
            return Object.freeze({
              verified: true,
              operationId: args.ref.operationId,
              artifactId: args.ref.artifactId,
              artifactHash: args.ref.artifactHash,
              source: 'shared-postgres',
            });
          }
        }
      }
      return verifyArtifactProofFs(args);
    },

    async readProofBytes(root, ref) {
      if (sharedProofStore != null) {
        const row = await sharedProofStore.get({ path: ref.path });
        if (row != null) return Buffer.from(row.content, 'utf8');
      }
      return readFile(path.resolve(root, ...ref.path.split('/')));
    },
  });
}
