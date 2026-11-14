import test from 'node:test';
import assert from 'node:assert/strict';
import { automaticLoginFailureMessage, sessionClosedNotification } from '../src/sessionRecovery.js';

test('explica cuándo el inicio automático volverá a intentarse', () => {
  const recovery = {
    recovered: false,
    reason: 'BROWSER_BUSY',
    message: automaticLoginFailureMessage({ reason: 'BROWSER_BUSY' })
  };

  assert.match(recovery.message, /volverá a intentar/i);
  assert.match(sessionClosedNotification(recovery), /volverá a intentar el inicio de sesión automático/i);
  assert.doesNotMatch(sessionClosedNotification(recovery), /inicia sesión para reanudar/i);
});

test('pide intervención manual con el motivo real cuando la cuenta recordada no sirve', () => {
  const message = sessionClosedNotification({
    recovered: false,
    reason: 'MANUAL_LOGIN_REQUIRED',
    message: 'La cuenta recordada ha caducado.'
  });

  assert.match(message, /No se pudo restablecer automáticamente/);
  assert.match(message, /La cuenta recordada ha caducado/);
  assert.match(message, /inicia sesión/);
});
