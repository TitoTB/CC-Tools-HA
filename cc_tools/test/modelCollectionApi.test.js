import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import { COLLECTION_URL, collectionModelIdFromNuxt, collectionModelIdFromRequest, collectionSessionHeaders, captureCollectionTarget, addModelToDefaultCollection } from '../src/modelCollectionApi.js';
import { chooseCandidates, isCollectionControlActive } from '../src/modelActionTask.js';

const modelId = '6a60842144eb4483e2202bed';
const profileId = '6a60842144eb4483e2202bf2';
const designUrl = 'https://www.crealitycloud.com/es/model-detail/benchy';
const filesUrl = 'https://www.crealitycloud.com/api/cxy/v3/model/fileListPage';
const headers = { __cxy_token_: 'test-session', __cxy_uid_: 'test-user', __cxy_app_ver_: '7.3.28' };
const target = () => ({ modelId, authenticationHeaders: headers });
function nuxt(id = modelId) {
  return JSON.stringify([['ShallowReactive', 1], { data: 2 }, ['ShallowReactive', 3], { 'model-info_benchy': 4 },
    { code: 5, result: 6 }, 0, { groupItem: 7 }, { id: 8 }, id]);
}
function pageFixture(text = '') {
  const page = new EventEmitter();
  const frame = {};
  page.mainFrame = () => frame;
  page.url = () => designUrl;
  page.locator = () => ({ textContent: async () => text });
  page.request = (url, payload, auth) => page.emit('request', {
    frame: () => frame, url: () => url, postDataJSON: () => payload, allHeaders: async () => auth
  });
  return page;
}

test('recupera el ID del modelo SSR sin profileId y distingue el ID de configuración', () => {
  assert.equal(collectionModelIdFromNuxt(nuxt(), designUrl), modelId);
  assert.equal(collectionModelIdFromNuxt(nuxt(), `${designUrl}?profileId=${profileId}`), modelId);
  assert.equal(collectionModelIdFromNuxt(nuxt(), designUrl.replace('benchy', 'other')), '');
  assert.equal(collectionModelIdFromNuxt(nuxt(), designUrl.replace('www.crealitycloud.com', 'example.test')), '');
  assert.equal(collectionModelIdFromNuxt('invalid', designUrl), '');
  assert.equal(collectionModelIdFromNuxt(nuxt('invalid'), designUrl), '');
});

test('no extrae IDs de recomendaciones ni perfiles del estado Nuxt', () => {
  const data = JSON.parse(nuxt());
  data[3] = { 'recommendations': 4, '3mf-list': 4 };
  assert.equal(collectionModelIdFromNuxt(JSON.stringify(data), designUrl), '');
  data[3] = { 'model-info_benchy': 4 };
  data[6] = { model3mfList: 7 };
  assert.equal(collectionModelIdFromNuxt(JSON.stringify(data), designUrl), '');
});

test('acepta modelId explícito de fileListPage en cuerpo o query, nunca profileId', () => {
  assert.equal(collectionModelIdFromRequest(filesUrl, { modelId }), modelId);
  assert.equal(collectionModelIdFromRequest(`${filesUrl}?modelId=${modelId}`), modelId);
  assert.equal(collectionModelIdFromRequest(filesUrl.replace('www.', 'api.'), { modelId }), modelId);
  assert.equal(collectionModelIdFromRequest(filesUrl, { profileId }), '');
  assert.equal(collectionModelIdFromRequest(filesUrl.replace('www.crealitycloud.com', 'example.test'), { modelId }), '');
});

test('filtra las credenciales y no mezcla sesiones incompletas', () => {
  assert.deepEqual(collectionSessionHeaders({ ...headers, Cookie: 'private', Authorization: 'private', __cxy_requestid_: 'old' }), headers);
  assert.equal(collectionSessionHeaders({ __cxy_token_: 'test-session' }), null);
});

test('reproduce el fallo 0.1.39: modelo SSR y sesión de otra API sin fileListPage', async () => {
  const page = pageFixture(nuxt());
  const capture = captureCollectionTarget(page);
  page.request('https://www.crealitycloud.com/api/cxy/v2/user/info', null, headers);
  const result = await capture.read(20);
  assert.equal(result.modelId, modelId);
  assert.equal(result.source, 'nuxt-model-info');
  assert.deepEqual(result.authenticationHeaders, headers);
  capture.stop();
  assert.equal(page.listenerCount('request'), 0);
});

test('combina modelId y sesión obtenidos de peticiones diferentes', async () => {
  const page = pageFixture();
  const capture = captureCollectionTarget(page);
  page.request(filesUrl, { modelId }, {});
  page.request('https://www.crealitycloud.com/api/cxy/v2/user/info', null, headers);
  const result = await capture.read(20);
  assert.equal(result.modelId, modelId);
  assert.equal(result.source, 'fileListPage');
  capture.stop();
});

test('distingue modelo ausente y sesión ausente sin revelar credenciales', async () => {
  for (const withModel of [true, false]) {
    const page = pageFixture(withModel ? nuxt() : '');
    const capture = captureCollectionTarget(page);
    if (!withModel) page.request('https://www.crealitycloud.com/api/cxy/v2/user/info', null, headers);
    await assert.rejects(capture.read(1), error => {
      assert.equal(error.code, withModel ? 'COLLECTION_SESSION_MISSING' : 'COLLECTION_MODEL_ID_MISSING');
      assert.equal(error.message.includes('test-session'), false);
      assert.equal(error.collectionContext.modelFound, withModel);
      return true;
    });
    capture.stop();
  }
});

function browser(fetch) {
  return {
    url: () => 'https://www.crealitycloud.com/es/model-detail/benchy?profileId=6a60842144eb4483e2202bf2',
    evaluate: (fn, argument) => vm.runInNewContext(`(${fn.toString()})(argument)`, { argument, fetch, AbortController, setTimeout, clearTimeout })
  };
}

test('envía una única alta a Default Collections usando el modelId de la ficha y un requestid nuevo', async () => {
  const calls = [];
  const page = browser(async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ code: 0, msg: 'ok' }) };
  });
  const result = await addModelToDefaultCollection(page, target());
  assert.equal(result.accepted, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, COLLECTION_URL);
  const options = calls[0].options;
  assert.equal(options.method, 'POST');
  assert.equal(options.credentials, 'include');
  assert.equal(options.redirect, 'error');
  assert.deepEqual(JSON.parse(options.body), { id: modelId, action: true });
  assert.equal(options.headers.__cxy_token_, headers.__cxy_token_);
  assert.match(options.headers.__cxy_requestid_, /^[a-f\d-]{36}$/);
  assert.equal(JSON.stringify(result).includes('test-session'), false);
});

test('HTTP 200 por sí solo no confirma el guardado', async () => {
  for (const [ok, status, code] of [[true, 200, 1], [false, 403, 0], [true, 200, undefined]]) {
    const result = await addModelToDefaultCollection(browser(async () => ({ ok, status, json: async () => ({ code }) })), target());
    assert.equal(result.accepted, false);
  }
  const invalidJson = await addModelToDefaultCollection(browser(async () => ({ ok: true, status: 200, json: async () => { throw Error('HTML'); } })), target());
  assert.equal(invalidJson.accepted, false);
});

test('una respuesta incierta no se reintenta ni expone credenciales en el error', async () => {
  let calls = 0;
  const page = browser(async () => { calls++; throw Error('test-session'); });
  await assert.rejects(addModelToDefaultCollection(page, target()), error => {
    assert.equal(error.code, 'COLLECTION_OUTCOME_UNKNOWN');
    assert.equal(String(error.stack).includes('test-session'), false);
    return true;
  });
  assert.equal(calls, 1);
});

test('impide enviar la sesión a otra página', async () => {
  const page = { url: () => 'https://example.test/', evaluate: () => { throw Error('No debe ejecutarse'); } };
  await assert.rejects(addModelToDefaultCollection(page, target()), { code: 'COLLECTION_ORIGIN_INVALID' });
});

test('reconoce un guardado existente y no confunde el contador con una selección', () => {
  assert.equal(isCollectionControlActive({ html: '<i class="icon-shoucang_mianxing"></i>' }), true);
  assert.equal(isCollectionControlActive({ ariaPressed: 'true' }), true);
  assert.equal(isCollectionControlActive({ className: 'collect', html: '<i class="icon-shoucang"></i><span>123</span>' }), false);
});

test('no vuelve a seleccionar modelos guardados o con un intento incierto', () => {
  const records = ['ambiguous', 'applied_uncredited', 'credited', 'already_applied', ''].map((collectionActionState, id) => ({ id, collectionActionState, url: `https://example.test/${id}` }));
  assert.deepEqual(chooseCandidates(records, 'collectionCompleted', 'collectionActionState').map(record => record.id), [4]);
});
