function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, expected) {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function parseRepositoryInspectionResult(result) {
  const fields = ['package', 'sourceFilesOnDisk', 'testFilesOnDisk'].sort();
  const packageFields = ['name', 'version'];
  if (!isPlainObject(result) || !hasExactKeys(result, fields)
    || !isPlainObject(result.package) || !hasExactKeys(result.package, packageFields)
    || typeof result.package.name !== 'string' || result.package.name.trim().length === 0
    || typeof result.package.version !== 'string' || result.package.version.trim().length === 0
    || !nonNegativeInteger(result.sourceFilesOnDisk) || !nonNegativeInteger(result.testFilesOnDisk)) {
    throw new TypeError('invalid repository inspection result');
  }
  return Object.freeze({
    package: Object.freeze({ name: result.package.name, version: result.package.version }),
    sourceFilesOnDisk: result.sourceFilesOnDisk,
    testFilesOnDisk: result.testFilesOnDisk,
  });
}

export function parseNodeTestExecutionResult(result) {
  const fields = ['command', 'exitCode', 'tests', 'passed', 'failed', 'skipped', 'stdout', 'stderr'].sort();
  if (!isPlainObject(result) || !hasExactKeys(result, fields)
    || typeof result.command !== 'string' || result.command.trim().length === 0
    || typeof result.stdout !== 'string' || typeof result.stderr !== 'string'
    || !nonNegativeInteger(result.exitCode) || !nonNegativeInteger(result.tests)
    || !nonNegativeInteger(result.passed) || !nonNegativeInteger(result.failed) || !nonNegativeInteger(result.skipped)
    || result.passed + result.failed + result.skipped !== result.tests) {
    throw new TypeError('invalid Node test result');
  }
  return Object.freeze({
    command: result.command,
    exitCode: result.exitCode,
    tests: result.tests,
    passed: result.passed,
    failed: result.failed,
    skipped: result.skipped,
    stdout: result.stdout,
    stderr: result.stderr,
  });
}
