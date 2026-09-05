import { execFile as execFileCallback } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const defaultExecFile = promisify(execFileCallback);
const MAX_FILES = 2_000;

async function walkJsFiles(dir, acc) {
  if (acc.length >= MAX_FILES) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    if (acc.length >= MAX_FILES) return;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'workspace' || entry.name === 'evidence') {
        continue;
      }
      await walkJsFiles(full, acc);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      acc.push(full);
    }
  }
}

/**
 * Deterministic Titan "build" gate: package identity + node --check on repo JS.
 * Not a webpack bundle — proves the runtime tree is syntactically loadable.
 */
export function createTitanBuildExecutor({
  execFile = defaultExecFile,
  timeoutMs = 120_000,
} = {}) {
  return Object.freeze({
    async build({ repositoryRoot } = {}) {
      if (typeof repositoryRoot !== 'string' || repositoryRoot.trim().length === 0) {
        throw new TypeError('repositoryRoot is required');
      }
      const root = path.resolve(repositoryRoot);
      const pkgRaw = await readFile(path.join(root, 'package.json'), 'utf8');
      const pkg = JSON.parse(pkgRaw);
      if (pkg.name !== 'athere-titan') {
        throw new Error(`unexpected package name: ${pkg.name}`);
      }

      const files = [];
      await walkJsFiles(path.join(root, 'packages'), files);
      await walkJsFiles(path.join(root, 'scripts'), files);
      await walkJsFiles(path.join(root, 'tests'), files);

      const failed = [];
      const checked = [];
      for (const file of files) {
        const relative = path.relative(root, file).replaceAll('\\', '/');
        try {
          await execFile(process.execPath, ['--check', file], {
            timeout: timeoutMs,
            maxBuffer: 256 * 1024,
            windowsHide: true,
          });
          checked.push(relative);
        } catch (error) {
          failed.push({
            file: relative,
            stderr: String(error.stderr ?? error.message ?? error).slice(0, 500),
          });
        }
      }

      return Object.freeze({
        operation: 'titan-build',
        command: 'node --check <packages|scripts|tests>/**/*.js',
        packageName: pkg.name,
        packageVersion: pkg.version,
        exitCode: failed.length === 0 ? 0 : 1,
        checkedCount: checked.length,
        failedCount: failed.length,
        checked: Object.freeze(checked.slice(0, 50)),
        failed: Object.freeze(failed),
        stdout: `checked ${checked.length} files; failed ${failed.length}`,
        stderr: failed.map((f) => `${f.file}: ${f.stderr}`).join('\n').slice(0, 4_000),
      });
    },
  });
}
