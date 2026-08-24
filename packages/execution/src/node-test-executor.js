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

function parseSummary(stdout) {
  const marker = '[ \\t]*(?:#|ℹ)[ \\t]*';
  const line = '\\r?\\n';
  const footer = new RegExp(
    `(?:^|${line})${marker}tests[ \\t]+(\\d+)[ \\t]*${line}`
    + `${marker}suites[ \\t]+(\\d+)[ \\t]*${line}`
    + `${marker}pass[ \\t]+(\\d+)[ \\t]*${line}`
    + `${marker}fail[ \\t]+(\\d+)[ \\t]*${line}`
    + `${marker}cancelled[ \\t]+(\\d+)[ \\t]*${line}`
    + `${marker}skipped[ \\t]+(\\d+)[ \\t]*${line}`
    + `${marker}todo[ \\t]+(\\d+)[ \\t]*${line}`
    + `${marker}duration_ms[ \\t]+(\\d+(?:\\.\\d+)?)[ \\t]*`,
    'gi',
  );
  const candidates = [...stdout.matchAll(footer)];
  if (candidates.length === 0) throw new Error('missing test summary: complete terminal footer');
  if (candidates.length !== 1) throw new Error('ambiguous test summary');
  const candidate = candidates[0];
  const end = candidate.index + candidate[0].length;
  if (!/^(?:\r?\n)?$/.test(stdout.slice(end))) throw new Error('test summary must be terminal');

  const [, testsText, , passedText, failedText, cancelledText, skippedText, todoText] = candidate;
  const tests = Number.parseInt(testsText, 10);
  const passed = Number.parseInt(passedText, 10);
  const failed = Number.parseInt(failedText, 10);
  const cancelled = Number.parseInt(cancelledText, 10);
  const skipped = Number.parseInt(skippedText, 10);
  const todo = Number.parseInt(todoText, 10);
  if (tests !== passed + failed + skipped + cancelled + todo) {
    throw new Error('inconsistent test summary');
  }
  return { tests, passed, failed, skipped };
}

const CODE_FILE = /\.(?:[cm]?js|jsx|[cm]?ts|tsx)$/i;
const TEST_FILE = /\.(?:test|spec)\.(?:[cm]?js|jsx|[cm]?ts|tsx)$/i;

async function countFiles(directory, include, relativePath = '') {
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
    const relativeEntryPath = path.join(relativePath, entry.name);
    if (entry.isDirectory()) count += await countFiles(entryPath, include, relativeEntryPath);
    else if (entry.isFile() && include(relativeEntryPath)) count += 1;
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
        sourceFilesOnDisk: await countFiles(path.join(root, 'packages'), (relativePath) => {
          return relativePath.split(path.sep).includes('src') && CODE_FILE.test(relativePath);
        }),
        testFilesOnDisk: await countFiles(path.join(root, 'tests'), (relativePath) => TEST_FILE.test(relativePath)),
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
