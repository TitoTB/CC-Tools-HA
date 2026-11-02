import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isCrealityApplicationPage,
  isCrealityIdentityPage,
  prioritizeRememberedAccount,
  profileSessionState,
  profileSessionUserId,
  rememberedAccountAutoLoginUrl,
  sessionCheckOutcome
} from '../src/browserManager.js';

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

test('activa el flujo nativo de acceso automático conservando el retorno OAuth', () => {
  const result = rememberedAccountAutoLoginUrl('https://id.creality.com/connect?lang=es-ES&client_id=cloud&redirect_uri=https%3A%2F%2Fwww.crealitycloud.com%2Foauth');
  const url = new URL(result);
  assert.equal(url.searchParams.get('auto_login'), '1');
  assert.equal(url.searchParams.get('client_id'), 'cloud');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://www.crealitycloud.com/oauth');
  assert.equal(rememberedAccountAutoLoginUrl('https://www.crealitycloud.com/es'), '');
});

test('prioriza la cuenta recordada que coincide con el perfil configurado', () => {
  const remembered = JSON.stringify([
    { userId: 'other', token: 'secret-other', time: 20, clientId: ['cloud'] },
    { userId: 'configured', token: 'secret-configured', time: 10, clientId: ['cloud'] }
  ]);
  const selection = prioritizeRememberedAccount(remembered, 'configured', 100);
  assert.equal(selection.ok, true);
  assert.equal(selection.userId, 'configured');
  const accounts = JSON.parse(selection.serialized);
  assert.equal(accounts.find((account) => account.userId === 'configured').time, 101);
  assert.equal(accounts.find((account) => account.userId === 'other').time, 20);
});

test('no elige una cuenta recordada ambigua o distinta del perfil', () => {
  const remembered = JSON.stringify([
    { userId: 'one', token: 'secret-one' },
    { userId: 'two', token: 'secret-two' }
  ]);
  assert.equal(prioritizeRememberedAccount(remembered).reason, 'REMEMBERED_ACCOUNT_AMBIGUOUS');
  assert.equal(prioritizeRememberedAccount(remembered, 'missing').reason, 'REMEMBERED_ACCOUNT_NOT_FOUND');
  assert.equal(prioritizeRememberedAccount('not-json', 'one').reason, 'REMEMBERED_ACCOUNT_INVALID');
});

test('extrae el usuario autenticado para evitar recuperar otra cuenta', () => {
  assert.equal(profileSessionUserId({
    result: { profileUserInfo: { base: { userId: 123 } } }
  }), '123');
  assert.equal(profileSessionUserId({ result: null }), '');
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

test('una comprobación inconclusa permite la tarea sin confirmar la sesión', () => {
  assert.deepEqual(sessionCheckOutcome('unknown'), {
    allowTask: true,
    confirmAuthenticated: false,
    state: 'inconclusive'
  });
  assert.deepEqual(sessionCheckOutcome('authenticated'), {
    allowTask: true,
    confirmAuthenticated: true,
    state: 'authenticated'
  });
});

test('solo revisa una sesión interactiva cuando ya volvió a Creality Cloud', () => {
  assert.equal(isCrealityApplicationPage('https://www.crealitycloud.com/es'), true);
  assert.equal(isCrealityApplicationPage('https://www.crealitycloud.com/es/workbench-beta/?type=1'), true);
  assert.equal(isCrealityApplicationPage('https://id.creality.com/connect'), false);
  assert.equal(isCrealityApplicationPage('not-a-url'), false);
});
