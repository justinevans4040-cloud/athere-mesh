/**
 * Shared mission/artifact proof bytes in Postgres (single-writer CAS authority unchanged).
 * Cross-host verify reads the same rows Lenovo wrote — no owner-local FS dependency.
 */

const PROOF_PATH = /^proofs\/[A-Za-z0-9][A-Za-z0-9_./-]{0,250}$/;
const SHA256 = /^[a-f0-9]{64}$/;

function requirePath(value) {
  if (typeof value !== 'string' || !PROOF_PATH.test(value)) {
    throw new Error('invalid proof path');
  }
  return value;
}

function requireSha256(value) {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw new Error('invalid proof sha256');
  }
  return value;
}

export async function createPostgresProofStore({ db }) {
  if (!db || typeof db.query !== 'function') throw new TypeError('Postgres query client is required');
  await db.query(`
    CREATE TABLE IF NOT EXISTS titan_proofs (
      proof_path TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      sha256 TEXT NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
      operation_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'mission',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  return Object.freeze({
    async put({ path: proofPath, content, sha256, operationId, kind = 'mission' }) {
      const key = requirePath(proofPath);
      const hash = requireSha256(sha256);
      if (typeof content !== 'string' || content.length === 0) {
        throw new TypeError('proof content must be a non-empty string');
      }
      if (typeof operationId !== 'string' || operationId.trim().length === 0) {
        throw new TypeError('operationId is required');
      }
      const existing = await db.query(
        'SELECT content, sha256 FROM titan_proofs WHERE proof_path = $1',
        [key],
      );
      if (existing.rows.length > 0) {
        const row = existing.rows[0];
        if (row.content !== content || row.sha256 !== hash) {
          throw new Error(`idempotency conflict: proof path already has different content: ${key}`);
        }
        return Object.freeze({ path: key, sha256: hash, duplicate: true });
      }
      await db.query(
        `INSERT INTO titan_proofs (proof_path, content, sha256, operation_id, kind)
         VALUES ($1, $2, $3, $4, $5)`,
        [key, content, hash, operationId.trim(), kind],
      );
      return Object.freeze({ path: key, sha256: hash, duplicate: false });
    },

    async get({ path: proofPath }) {
      const key = requirePath(proofPath);
      const result = await db.query(
        'SELECT content, sha256, operation_id, kind FROM titan_proofs WHERE proof_path = $1',
        [key],
      );
      if (result.rows.length === 0) return null;
      const row = result.rows[0];
      return Object.freeze({
        path: key,
        content: row.content,
        sha256: row.sha256,
        operationId: row.operation_id,
        kind: row.kind,
      });
    },
  });
}
