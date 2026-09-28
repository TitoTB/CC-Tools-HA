import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { internalTaskId } from '../src/homeAssistantApi.js';

const source = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const start = source.indexOf('async function setIntegrationTaskEnabled(');
const fn = source.slice(start, source.indexOf('\n}', start) + 2);
function setup() {
  const context = vm.createContext({ rebuildSchedulesForTimezone: async config => {
    config.tasks.modelCollections.nextRunAt = '2026-09-29T09:00:00Z';
  } });
  vm.runInContext(fn, context);
  const config = { tasks: {
    modelDownloads: { enabled: false }, modelLikes: { enabled: false },
    modelCollections: { enabled: false, nextRunAt: '' }
  } };
  return { config, set: enabled => context.setIntegrationTaskEnabled(config, internalTaskId('collections'), enabled), context };
}

test('HA exige Descubrir diseños para activar colecciones y programa al activarlas', async () => {
  const flow = setup();
  await assert.rejects(flow.set(true), { code: 'MODEL_DOWNLOADS_REQUIRED' });
  assert.equal(flow.config.tasks.modelCollections.enabled, false);
  flow.config.tasks.modelDownloads.enabled = true;
  await flow.set(true);
  assert.equal(flow.config.tasks.modelCollections.enabled, true);
  assert.equal(flow.config.tasks.modelCollections.nextRunAt, '2026-09-29T09:00:00Z');
  await flow.set(false);
  assert.equal(flow.config.tasks.modelCollections.enabled, false);
  assert.equal(flow.config.tasks.modelCollections.nextRunAt, '');
});

test('desactivar Descubrir diseños desde HA cancela también la programación de colecciones', async () => {
  const flow = setup();
  flow.config.tasks.modelDownloads.enabled = true;
  await flow.set(true);
  await flow.context.setIntegrationTaskEnabled(flow.config, 'modelDownloads', false);
  assert.equal(flow.config.tasks.modelCollections.enabled, false);
  assert.equal(flow.config.tasks.modelCollections.nextRunAt, '');
});
