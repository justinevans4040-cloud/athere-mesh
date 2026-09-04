import test from "node:test";
import assert from "node:assert/strict";

test("remote executor smoke pin", () => {
  assert.equal(1 + 1, 2);
});
