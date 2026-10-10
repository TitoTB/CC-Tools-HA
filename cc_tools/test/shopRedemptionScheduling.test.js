import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { executeWithTimeout } from '../src/scheduler.js';

function harness(outcome, options = {}) {
  const source = fs.readFileSync(new URL('../src/scheduler.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function redeemScheduledShopGoal(');
  const end = source.indexOf('\nexport function updateNextRunAfterExecution', start);
  const writes = [], messages = [], runs = [];
  let attempts = 0, aborts = 0;
  const context = vm.createContext({ Date, Number, Error, console,
    activeRunToken: 1, taskExecutionTimeoutMs: () => options.timeoutMs ?? 60000,
    beginSchedulerRun: () => 1, releaseSchedulerRun: () => {},
    executeWithTimeout,
    abortAutomationBrowser: async () => { aborts++; },
    writeConfig: async config => { writes.push(structuredClone(config)); },
    appendRun: async run => { runs.push(run); },
    sendTelegram: async (config, message) => { messages.push(message); },
    diagnoseTaskError: async (error, a, b, detail) => detail,
    redeemShopGoal: async () => {
      attempts++;
      assert.equal(writes[0].shopGoal.enabled, false, 'pause must be durable before opening the browser');
      assert.equal(writes[0].shopGoal.lastStatus, 'submitting');
      if (outcome instanceof Error) throw outcome;
      return typeof outcome === 'function' ? outcome() : outcome;
    }
  });
  vm.runInContext(source.slice(start, end), context);
  return { run: context.redeemScheduledShopGoal, writes, messages, runs, attempts: () => attempts, aborts: () => aborts };
}
const config = () => ({ shopGoal: { enabled: true, productId: 'petg', name: 'PETG', points: 3473, lastStatus: 'scheduled' }, points: { total: 4100 }, telegram: { enabled: true } });

test('un resultado incierto queda pausado y no genera reintentos ni avisos repetidos', async () => {
  const error = Object.assign(new Error('Respuesta perdida'), { code: 'SHOP_REDEEM_UNVERIFIED' });
  const h = harness(error), c = config();
  await h.run(c, new Date('2026-10-10T10:00:00Z'));
  assert.equal(c.shopGoal.enabled, false);
  assert.equal(c.shopGoal.lastStatus, 'paused');
  await h.run(c, new Date('2026-10-10T11:00:00Z'));
  assert.equal(h.attempts(), 1);
  assert.equal(h.messages.length, 1);
  assert.match(h.messages[0], /pausado/);
  const restarted = structuredClone(h.writes[0]);
  await h.run(restarted, new Date('2026-10-10T12:00:00Z'));
  assert.equal(h.attempts(), 1, 'a restart during submission must not repeat it');
});

test('solo registra éxito con pedido confirmado y conserva su número', async () => {
  const h = harness({ success: true, orderNumber: 'ORDER-1', remainingPoints: 627 }), c = config();
  await h.run(c);
  assert.equal(c.shopGoal.enabled, false);
  assert.equal(c.shopGoal.lastStatus, 'success');
  assert.equal(c.points.total, 627);
  assert.equal(h.runs[0].details.orderNumber, 'ORDER-1');
});

test('no registra éxito si falta el número de pedido', async () => {
  const h = harness({ success: true }), c = config();
  await h.run(c);
  assert.equal(c.shopGoal.lastStatus, 'paused');
  assert.equal(h.runs[0].status, 'error');
});

for (const state of ['insufficient', 'unavailable']) test(`mantiene la espera automática para ${state} sin notificar errores`, async () => {
  const h = harness({ [state]: true, availablePoints: 1000 }), c = config();
  await h.run(c);
  assert.equal(c.shopGoal.enabled, true);
  assert.equal(c.points.total, 1000);
  assert.equal(h.messages.length, 0);
});

test('un navegador ocupado conserva el objetivo sin notificar un error de canje', async () => {
  const h = harness(Object.assign(new Error('Ocupado'), { code: 'BROWSER_BUSY' })), c = config();
  assert.equal(await h.run(c), false);
  assert.equal(c.shopGoal.enabled, true);
  assert.equal(c.shopGoal.lastStatus, 'scheduled');
  assert.equal(h.messages.length, 0);
});


test('un timeout pausa el canje y no lo repite en la siguiente revisión', async () => {
  const h = harness(() => new Promise(() => {}), { timeoutMs: 20 }), c = config();
  await h.run(c);
  assert.equal(h.aborts(), 1);
  assert.equal(c.shopGoal.enabled, false);
  assert.equal(c.shopGoal.lastStatus, 'paused');
  assert.equal(h.runs[0].details.diagnostics[0].code, 'TASK_EXECUTION_TIMEOUT');
  await h.run(c, new Date(Date.now() + 3600000));
  assert.equal(h.attempts(), 1);
});
