import test from 'node:test';
import assert from 'node:assert/strict';
import { profileSessionState } from '../src/browserManager.js';

test('reconoce una respuesta autenticada del perfil', () => {
  assert.equal(profileSessionState({
    code: 0,
    result: { profileUserInfo: { base: { userId: '123', nickName: 'Aguacatec' } } }
  }), 'authenticated');
});

test('reconoce token inválido y perfil vacío como sesión cerrada', () => {
  assert.equal(profileSessionState({ code: 4, msg: 'Invalid Token' }), 'logged_out');
  assert.equal(profileSessionState({ code: 0, result: null }), 'logged_out');
  assert.equal(profileSessionState({}, 401), 'logged_out');
});

test('no confunde una respuesta desconocida con una sesión cerrada', () => {
  assert.equal(profileSessionState(null), 'unknown');
  assert.equal(profileSessionState({ code: 503, msg: 'Unavailable' }), 'unknown');
});
