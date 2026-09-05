import { mkdir, readdir, rename, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const MAX_ENTRIES = 5_000;

const TARGET_ROOTS = Object.freeze({
  downloads: () => path.join(os.homedir(), 'Downloads'),
  desktop: () => path.join(os.homedir(), 'Desktop'),
  documents: () => path.join(os.homedir(), 'Documents'),
  workspace: (repoRoot) => path.join(repoRoot, 'workspace'),
  scratch: () => path.join(os.homedir(), 'Desktop', 'athere-mesh-scratch'),
});

function requireTarget(target) {
  if (typeof target !== 'string' || !Object.hasOwn(TARGET_ROOTS, target)) {
    throw new Error(`unsupported file work target: ${target}`);
  }
  return target;
}

export function resolveFileWorkRoot({ target, repositoryRoot }) {
  const key = requireTarget(target);
  const resolver = TARGET_ROOTS[key];
  const root = key === 'workspace' ? resolver(repositoryRoot) : resolver();
  return path.resolve(root);
}

function extensionBucket(name) {
  const ext = path.extname(name).replace(/^\./, '').toLowerCase();
  if (!ext) return 'no-extension';
  return ext;
}

async function walkInventory(root, maxEntries) {
  const entries = [];
  const queue = [''];
  while (queue.length > 0) {
    if (entries.length >= maxEntries) {
      throw new Error(`inventory exceeded max entries (${maxEntries})`);
    }
    const relative = queue.shift();
    const absolute = relative ? path.join(root, relative) : root;
    let dirents;
    try {
      dirents = await readdir(absolute, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') {
        return { root, exists: false, files: [], directories: [], truncated: false };
      }
      throw error;
    }
    for (const dirent of dirents) {
      if (entries.length >= maxEntries) {
        return {
          root,
          exists: true,
          files: entries.filter((e) => e.kind === 'file'),
          directories: entries.filter((e) => e.kind === 'directory'),
          truncated: true,
        };
      }
      const childRelative = relative ? path.join(relative, dirent.name) : dirent.name;
      if (dirent.isDirectory()) {
        entries.push({ kind: 'directory', path: childRelative.replaceAll('\\', '/') });
        queue.push(childRelative);
      } else if (dirent.isFile()) {
        const info = await stat(path.join(root, childRelative));
        entries.push({
          kind: 'file',
          path: childRelative.replaceAll('\\', '/'),
          bytes: info.size,
          extension: extensionBucket(dirent.name),
        });
      }
    }
  }
  return {
    root,
    exists: true,
    files: entries.filter((e) => e.kind === 'file'),
    directories: entries.filter((e) => e.kind === 'directory'),
    truncated: false,
  };
}

/**
 * Bounded filesystem worker for owner perform commands (not Titan self-test).
 * Jail: only named targets under the operator home / repo workspace.
 */
export function createWorkspaceFileExecutor({ repositoryRoot } = {}) {
  if (typeof repositoryRoot !== 'string' || repositoryRoot.trim().length === 0) {
    throw new TypeError('repositoryRoot is required');
  }
  const repoRoot = path.resolve(repositoryRoot);

  return Object.freeze({
    async inventory({ target, maxEntries = MAX_ENTRIES } = {}) {
      const root = resolveFileWorkRoot({ target, repositoryRoot: repoRoot });
      const result = await walkInventory(root, maxEntries);
      return Object.freeze({
        operation: 'inventory',
        target,
        root: result.root,
        exists: result.exists,
        fileCount: result.files.length,
        directoryCount: result.directories.length,
        truncated: result.truncated,
        files: Object.freeze(result.files.slice(0, 200)),
        directories: Object.freeze(result.directories.slice(0, 100)),
      });
    },

    async organizeByType({ target, dryRun = false } = {}) {
      const root = resolveFileWorkRoot({ target, repositoryRoot: repoRoot });
      let dirents;
      try {
        dirents = await readdir(root, { withFileTypes: true });
      } catch (error) {
        if (error.code === 'ENOENT') {
          return Object.freeze({
            operation: 'organize-by-type',
            target,
            root,
            exists: false,
            moved: [],
            dryRun,
          });
        }
        throw error;
      }
      const moved = [];
      for (const dirent of dirents) {
        if (!dirent.isFile()) continue;
        const bucket = extensionBucket(dirent.name);
        const from = path.join(root, dirent.name);
        const toDir = path.join(root, bucket);
        const to = path.join(toDir, dirent.name);
        if (!dryRun) {
          await mkdir(toDir, { recursive: true });
          await rename(from, to);
        }
        moved.push({
          from: dirent.name,
          to: path.join(bucket, dirent.name).replaceAll('\\', '/'),
          bucket,
        });
      }
      return Object.freeze({
        operation: 'organize-by-type',
        target,
        root,
        exists: true,
        dryRun,
        movedCount: moved.length,
        moved: Object.freeze(moved),
      });
    },
  });
}
