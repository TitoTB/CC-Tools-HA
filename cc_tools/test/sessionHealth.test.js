import test from 'node:test';
import assert from 'node:assert/strict';
import {
  automaticLoginDue,
  crealitySessionState,
  markAutomaticLoginAttempt,
  pauseForExpiredSession,
  resumeAfterAuthenticatedLogin
} from '../src/sessionHealth.js';

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

test('limita los reintentos automáticos y conserva la preferencia al cambiar de estado', () => {
  const config = {
    automationHealth: { state: 'active' },
    crealitySession: { autoLoginEnabled: true }
  };
  const now = new Date('2026-10-15T08:00:00.000Z');

  assert.equal(automaticLoginDue(config, now), true);
  markAutomaticLoginAttempt(config, 'attempting', '', now);
  assert.equal(automaticLoginDue(config, new Date('2026-10-15T08:29:59.000Z')), false);
  assert.equal(automaticLoginDue(config, new Date('2026-10-15T08:30:00.000Z')), true);

  pauseForExpiredSession(config, 'creality', {}, now);
  assert.equal(config.crealitySession.autoLoginEnabled, true);
  resumeAfterAuthenticatedLogin(config, null, now);
  assert.equal(config.crealitySession.autoLoginEnabled, true);
});
