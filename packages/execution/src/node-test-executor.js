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
  const lines = stdout.split(/\r?\n/);
  const summaryLine = /^\s*(?:#|ℹ)\s*(tests|pass|fail|cancelled|skipped|todo)\s+(\d+)\s*$/i;
  const testStarts = lines.flatMap((line, index) => summaryLine.exec(line)?.[1].toLowerCase() === 'tests' ? [index] : []);
  if (testStarts.length === 0) throw new Error('missing test summary: tests');

  const finalStart = testStarts.at(-1);
  const values = new Map();
  for (const line of lines.slice(finalStart)) {
    const match = summaryLine.exec(line);
    if (!match) continue;
    const name = match[1].toLowerCase();
    if (!values.has(name)) values.set(name, Number.parseInt(match[2], 10));
  }
  for (const name of ['tests', 'pass', 'fail', 'skipped']) {
    if (!values.has(name)) throw new Error(`missing test summary: ${name}`);
  }
  const tests = values.get('tests');
  const passed = values.get('pass');
  const failed = values.get('fail');
  const skipped = values.get('skipped');
  const cancelled = values.get('cancelled') ?? 0;
  const todo = values.get('todo') ?? 0;
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
        sourceFiles: await countFiles(path.join(root, 'packages'), (relativePath) => {
          return relativePath.split(path.sep).includes('src') && CODE_FILE.test(relativePath);
        }),
        testFiles: await countFiles(path.join(root, 'tests'), (relativePath) => TEST_FILE.test(relativePath)),
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
