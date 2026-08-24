import { execFile as execFileCallback } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const DEFAULT_TIMEOUT_MS = 300_000;
const MAX_OUTPUT_BYTES = 1_048_576;
const defaultExecFile = promisify(execFileCallback);

function requireRepositoryRoot(repositoryRoot) {
  if (typeof repositoryRoot !== 'string' || repositoryRoot.trim().length === 0) {
    throw new TypeError('repositoryRoot is required');
  }
  return path.resolve(repositoryRoot);
}

function text(value) {
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  return typeof value === 'string' ? value : '';
}

function summaryValue(stdout, name) {
  const match = stdout.match(new RegExp(`(?:^|\\n)\\s*(?:#|ℹ)\\s*${name}\\s+(\\d+)\\s*(?:\\n|$)`, 'i'));
  if (!match) throw new Error(`missing test summary: ${name}`);
  return Number.parseInt(match[1], 10);
}

function parseSummary(stdout) {
  return {
    tests: summaryValue(stdout, 'tests'),
    passed: summaryValue(stdout, 'pass'),
    failed: summaryValue(stdout, 'fail'),
    skipped: summaryValue(stdout, 'skipped'),
  };
}

async function countFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }

  let count = 0;
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) count += await countFiles(entryPath);
    else if (entry.isFile()) count += 1;
  }
  return count;
}

function exitCodeFrom(error) {
  if (Number.isSafeInteger(error?.code)) return error.code;
  return 1;
}

export function createNodeTestExecutor({ repositoryRoot, execFileImpl = defaultExecFile } = {}) {
  const root = requireRepositoryRoot(repositoryRoot);
  if (typeof execFileImpl !== 'function') throw new TypeError('execFileImpl must be a function');

  return Object.freeze({
    async inspect() {
      const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
      return Object.freeze({
        package: Object.freeze({ name: packageJson.name, version: packageJson.version }),
        sourceFiles: await countFiles(path.join(root, 'packages')),
        testFiles: await countFiles(path.join(root, 'tests')),
      });
    },

    async runTests() {
      const options = {
        cwd: root,
        shell: false,
        timeout: DEFAULT_TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_BYTES,
        windowsHide: true,
      };
      let processResult;
      let exitCode = 0;
      try {
        processResult = await execFileImpl(process.execPath, ['--test'], options);
      } catch (error) {
        processResult = error;
        exitCode = exitCodeFrom(error);
      }
      const stdout = text(processResult?.stdout);
      const stderr = text(processResult?.stderr);
      const totals = parseSummary(stdout);
      return Object.freeze({
        command: 'node --test',
        exitCode,
        ...totals,
        stdout,
        stderr,
      });
    },
  });
}
