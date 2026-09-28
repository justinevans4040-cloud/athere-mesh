import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('Command Deck exposes live mission control surfaces', async () => {
  const html = await source('apps/command-deck/index.html');
  for (const id of [
    'missionStrip',
    'missionState',
    'missionElapsed',
    'activeAgent',
    'lastEvent',
    'meshMap',
    'signalLayer',
    'proofStages',
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
  }
});

test('Command Deck polls live mission state and turns trace events into visible activity', async () => {
  const js = await source('apps/command-deck/deck.js');
  assert.match(js, /currentJob/);
  assert.match(js, /\/api\/missions\//);
  assert.match(js, /executionTrace/);
  assert.match(js, /pollLiveMission/);
  assert.match(js, /1000/);
  assert.match(js, /fireSignalPing/);
  assert.match(js, /markAgentActive/);
  assert.match(js, /renderProofStages/);
});

test('renderProof binds the mission before rendering QR18 proof stages', async () => {
  const js = await source('apps/command-deck/deck.js');
  const renderProof = js.match(/function renderProof\(result\) \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(renderProof, /const mission = result\?\.mission \|\| \{\};/);
  assert.match(renderProof, /renderProofStages\(mission\)/);
});

test('Command Deck motion is event-driven and visibly styled', async () => {
  const css = await source('apps/command-deck/deck.css');
  for (const selector of [
    '.mission-strip',
    '.mesh-map',
    '.mesh-node',
    '.signal-ping',
    '.agent-card.active-now',
    '.proof-stage',
  ]) {
    assert.ok(css.includes(selector), `missing ${selector}`);
  }
  assert.match(css, /@keyframes\s+signal/);
});
