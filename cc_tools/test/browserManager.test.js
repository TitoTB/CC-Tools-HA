import test from 'node:test';
import assert from 'node:assert/strict';
import { isCrealityApplicationPage, isCrealityIdentityPage, profileSessionState } from '../src/browserManager.js';

test('reconoce una respuesta autenticada del perfil', () => {
  assert.equal(profileSessionState({
    code: 0,
    result: { profileUserInfo: { base: { userId: '123', nickName: 'Aguacatec' } } }
  }), 'authenticated');
});

test('distingue la página de identidad usada para recuperar la sesión', () => {
  assert.equal(isCrealityIdentityPage('https://id.creality.com/connect?client_id=creality_cloud'), true);
  assert.equal(isCrealityIdentityPage('https://www.crealitycloud.com/es'), false);
  assert.equal(isCrealityIdentityPage('not-a-url'), false);
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

test('solo revisa una sesión interactiva cuando ya volvió a Creality Cloud', () => {
  assert.equal(isCrealityApplicationPage('https://www.crealitycloud.com/es'), true);
  assert.equal(isCrealityApplicationPage('https://www.crealitycloud.com/es/workbench-beta/?type=1'), true);
  assert.equal(isCrealityApplicationPage('https://id.creality.com/connect'), false);
  assert.equal(isCrealityApplicationPage('not-a-url'), false);
});
