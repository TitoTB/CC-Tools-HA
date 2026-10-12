import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { executeWithTimeout } from '../src/scheduler.js';

function harness(outcome, options = {}) {
  const source = fs.readFileSync(new URL('../src/scheduler.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function redeemScheduledShopGoal(');
  const end = source.indexOf('\nexport function updateNextRunAfterExecution', start);
  const writes = [];
  const messages = [];
  const runs = [];
  let attempts = 0;
  let aborts = 0;
  const context = vm.createContext({
    Date,
    Number,
    Error,
    console,
    activeRunToken: 1,
    taskExecutionTimeoutMs: () => options.timeoutMs ?? 60000,
    beginSchedulerRun: () => 1,
    releaseSchedulerRun: () => {},
    executeWithTimeout,
    abortAutomationBrowser: async () => { aborts += 1; },
    writeConfig: async (config) => { writes.push(structuredClone(config)); },
    appendRun: async (run) => { runs.push(run); },
    sendTelegram: async (_config, message) => { messages.push(message); },
    diagnoseTaskError: async (_error, _page, _context, detail) => detail,
    pauseForExpiredSession: () => ({ notificationRequired: true }),
    redeemShopGoal: async () => {
      attempts += 1;
      assert.equal(writes[0].shopGoal.enabled, false);
      assert.equal(writes[0].shopGoal.lastStatus, 'submitting');
      if (outcome instanceof Error) throw outcome;
      return typeof outcome === 'function' ? outcome() : outcome;
    }
  });
  vm.runInContext(source.slice(start, end), context);
  return {
    run: context.redeemScheduledShopGoal,
    writes,
    messages,
    runs,
    attempts: () => attempts,
    aborts: () => aborts
  };
}

const config = () => ({
  shopGoal: {
    enabled: true,
    productId: 'petg',
    name: 'PETG',
    points: 3473,
    lastStatus: 'scheduled',
    lastMessage: ''
  },
  points: { total: 4100 },
  telegram: { enabled: true }
});

test('un resultado incierto queda pausado y no vuelve a intentarse', async () => {
  const error = Object.assign(new Error('Respuesta perdida'), { code: 'SHOP_REDEEM_UNVERIFIED' });
  const h = harness(error);
  const current = config();
  await h.run(current, new Date('2026-10-12T10:00:00Z'));
  assert.equal(current.shopGoal.enabled, false);
  assert.equal(current.shopGoal.lastStatus, 'paused');
  await h.run(current, new Date('2026-10-12T11:00:00Z'));
  assert.equal(h.attempts(), 1);
});

test('solo registra éxito con un número de pedido confirmado', async () => {
  const h = harness({ success: true, orderNumber: 'ORDER-1', remainingPoints: 627 });
  const current = config();
  await h.run(current);
  assert.equal(current.shopGoal.lastStatus, 'success');
  assert.equal(h.runs[0].details.orderNumber, 'ORDER-1');
});

test('un timeout pausa el canje antes de permitir otro intento', async () => {
  const h = harness(() => new Promise(() => {}), { timeoutMs: 20 });
  const current = config();
  await h.run(current);
  assert.equal(h.aborts(), 1);
  assert.equal(current.shopGoal.enabled, false);
  assert.equal(current.shopGoal.lastStatus, 'paused');
});

test('una sesión cerrada conserva el objetivo y pausa las automatizaciones', async () => {
  const error = Object.assign(new Error('Sesión cerrada'), { code: 'LOGIN_REQUIRED', diagnostic: { code: 'LOGIN_REQUIRED' } });
  const h = harness(error);
  const current = config();
  await h.run(current);
  assert.equal(current.shopGoal.enabled, true);
  assert.equal(current.shopGoal.lastStatus, 'scheduled');
  assert.match(h.messages[0], /Sesión de Creality Cloud cerrada/);
});
