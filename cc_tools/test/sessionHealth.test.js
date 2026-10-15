import test from 'node:test';
import assert from 'node:assert/strict';
import { crealitySessionState, pauseForExpiredSession, resumeAfterAuthenticatedLogin } from '../src/sessionHealth.js';

test('pausa una sola vez hasta que se confirme un nuevo login', () => {
  const config = { automationHealth: { state: 'active' }, crealityProfile: {} };
  const now = new Date('2026-10-12T08:00:00.000Z');

  const first = pauseForExpiredSession(config, 'modelDownloads', {}, now);
  const second = pauseForExpiredSession(config, 'finishPrint', {}, now);

  assert.equal(first.notificationRequired, true);
  assert.equal(second.notificationRequired, false);
  assert.equal(config.automationHealth.state, 'paused');
  assert.equal(config.automationHealth.reasonCode, 'LOGIN_REQUIRED');
  assert.equal(config.automationHealth.pausedUntil, '');
  assert.deepEqual(crealitySessionState(config).state, 'closed');

  assert.equal(resumeAfterAuthenticatedLogin(config, { userId: '123', name: 'Aguacatec' }, now), true);
  assert.equal(config.automationHealth.state, 'active');
  assert.equal(config.crealityProfile.name, 'Aguacatec');
  assert.deepEqual(crealitySessionState(config).state, 'open');
});
