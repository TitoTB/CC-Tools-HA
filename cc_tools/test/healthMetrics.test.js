import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHealthMetrics } from '../src/healthMetrics.js';

test('resume la salud de las automatizaciones durante las últimas 24 horas', () => {
  const now = new Date('2026-09-20T12:00:00Z');
  const config = { automationHealth: { state: 'active' } };
  const runs = [
    run('success', '2026-09-20T11:00:00Z'),
    run('failed', '2026-09-20T10:00:00Z', 'REWARD_COOLDOWN_SUSPECTED'),
    run('error', '2026-09-20T09:00:00Z', 'RATE_LIMITED'),
    run('success', '2026-09-18T09:00:00Z')
  ];

  const metrics = buildHealthMetrics(config, runs, now);
  assert.equal(metrics.attempts, 3);
  assert.equal(metrics.successes, 1);
  assert.equal(metrics.failures, 2);
  assert.equal(metrics.successRate, 33);
  assert.equal(metrics.rewardNotCredited, 1);
  assert.equal(metrics.rateLimited, 1);
  assert.equal(metrics.state, 'degraded');
});

test('un estado pausado prevalece sobre la tasa de éxito', () => {
  const config = {
    automationHealth: {
      state: 'paused',
      reasonCode: 'RATE_LIMITED',
      reason: 'Límite temporal',
      pausedUntil: '2026-09-20T13:00:00Z',
      pauseSource: 'retry-after'
    }
  };
  const metrics = buildHealthMetrics(config, [], new Date('2026-09-20T12:00:00Z'));
  assert.equal(metrics.state, 'paused');
  assert.equal(metrics.pauseSource, 'retry-after');
});

test('una descarga sin recompensa acreditada no cuenta como éxito', () => {
  const config = { automationHealth: { state: 'active' } };
  const metrics = buildHealthMetrics(config, [{
    taskId: 'modelDownloads',
    status: 'success',
    finishedAt: '2026-09-20T11:00:00Z',
    details: { downloaded: [{ rewardStatus: 'unverified' }] }
  }], new Date('2026-09-20T12:00:00Z'));

  assert.equal(metrics.attempts, 1);
  assert.equal(metrics.successes, 0);
  assert.equal(metrics.failures, 1);
});

function run(status, finishedAt, code = '') {
  return {
    taskId: 'modelLikes',
    status,
    finishedAt,
    details: code ? { diagnostics: [{ code }] } : {}
  };
}
