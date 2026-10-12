import test from 'node:test';
import assert from 'node:assert/strict';
import { createFavoriteProfileHandler } from '../src/favoriteProfileAdmission.js';
import { normalizeFavoriteProfiles } from '../src/favoriteProfiles.js';

const profile = { userId: '123456789', name: 'Maker', profileUrl: 'https://www.crealitycloud.com/es/user/123456789' };
const emptyMessage = 'Este perfil todavía no tiene diseños publicados para seguir. No se ha añadido a favoritos. Inténtalo de nuevo más adelante.';

function harness({ error, duringRead, logError } = {}) {
  let config = { crealityProfile: { userId: '987654321' }, crealityFavorites: normalizeFavoriteProfiles([]) };
  const calls = { writes: [], scans: [], runs: [], reads: [] };
  const handler = createFavoriteProfileHandler({
    readConfig: async () => structuredClone(config),
    writeConfig: async value => { config = structuredClone(value); calls.writes.push(value); },
    readCrealityProfile: async () => config.crealityProfile,
    readFavoriteProfile: async (url, options) => {
      calls.reads.push({ url, options });
      duringRead?.(config);
      if (error) throw error;
      return { ...profile };
    },
    queueFavoriteProfileSync: (...args) => calls.scans.push(args),
    appendRun: async value => { if (logError) throw logError; calls.runs.push(value); }
  });
  return { calls, config: () => config, async request(url = profile.profileUrl) {
    const response = { statusCode: 200, status(value) { this.statusCode = value; return this; },
      json(value) { this.body = value; return this; } };
    await handler({ body: { url } }, response);
    return response;
  } };
}

test('un perfil vacío nunca se guarda ni se indexa; registra un aviso con enlace', async () => {
  const h = harness({ error: Object.assign(new Error(emptyMessage), { code: 'FAVORITE_PROFILE_NO_MODELS' }) });
  const original = structuredClone(h.config());
  const response = await h.request();
  assert.equal(response.statusCode, 422);
  assert.equal(response.body.error, 'FAVORITE_PROFILE_NO_MODELS');
  assert.deepEqual(h.config(), original);
  assert.equal(h.calls.writes.length, 0);
  assert.equal(h.calls.scans.length, 0);
  assert.deepEqual(h.calls.reads[0], { url: profile.profileUrl, options: { requireModels: true } });
  assert.equal(h.calls.runs.length, 1);
  const run = h.calls.runs[0];
  assert.equal(run.status, 'warning');
  assert.equal(run.taskId, 'favoriteProfiles');
  assert.equal(run.message, emptyMessage);
  assert.equal(run.details.profileAdmission.url, profile.profileUrl);
  assert.equal(response.body.profileUrl, profile.profileUrl);
});

test('una carga no confirmada se rechaza como error técnico y conserva los favoritos', async () => {
  const h = harness({ error: Object.assign(new Error('No se pudo comprobar el listado.'), { code: 'FAVORITE_PROFILE_MODELS_UNCONFIRMED' }) });
  const original = structuredClone(h.config());
  const response = await h.request();
  assert.equal(response.statusCode, 409);
  assert.equal(h.calls.runs[0].status, 'error');
  assert.equal(h.calls.runs[0].details.profileAdmission.url, profile.profileUrl);
  assert.deepEqual(h.config(), original);
  assert.equal(h.calls.scans.length, 0);
});

test('guarda e indexa el perfil solo después de confirmar diseños, sin perder cambios durante la consulta', async () => {
  const h = harness({ duringRead: config => { config.preference = 'changed'; } });
  const response = await h.request();
  assert.equal(response.body.ok, true);
  assert.equal(h.config().preference, 'changed');
  assert.equal(h.config().crealityFavorites.filter(item => item.userId === profile.userId).length, 1);
  assert.equal(h.calls.writes.length, 1);
  assert.equal(h.calls.scans.length, 1);
  assert.equal(h.calls.scans[0][0].indexStatus, 'pending');
  assert.equal(h.calls.runs.length, 0);
});

test('rechaza URL inválida, perfil propio y favorito duplicado antes de navegar', async () => {
  const h = harness();
  for (const [url, code] of [
    ['https://example.com/user/123', 'FAVORITE_PROFILE_URL_INVALID'],
    ['https://www.crealitycloud.com/es/user/987654321', 'FAVORITE_PROFILE_IS_OWN'],
    [h.config().crealityFavorites[0].profileUrl, 'FAVORITE_PROFILE_DUPLICATE']
  ]) assert.equal((await h.request(url)).body.error, code);
  assert.equal(h.calls.reads.length, 0);
  assert.equal(h.calls.writes.length, 0);
});

test('comprueba de nuevo los duplicados y la cuenta después de la visita', async () => {
  const duplicate = harness({ duringRead: config => config.crealityFavorites.push(profile) });
  assert.equal((await duplicate.request()).body.error, 'FAVORITE_PROFILE_DUPLICATE');
  assert.equal(duplicate.calls.writes.length, 0);
  const changed = harness({ duringRead: config => { config.crealityProfile.userId = '555555'; } });
  assert.equal((await changed.request()).body.error, 'FAVORITE_PROFILE_ACCOUNT_CHANGED');
  assert.equal(changed.calls.writes.length, 0);
  assert.equal(changed.calls.scans.length, 0);
});

test('un fallo de guardado del aviso tampoco permite añadir el perfil vacío', async () => {
  const h = harness({ error: Object.assign(new Error(emptyMessage), { code: 'FAVORITE_PROFILE_NO_MODELS' }),
    logError: new Error('Disco no disponible') });
  const response = await h.request();
  assert.equal(response.statusCode, 500);
  assert.equal(response.body.error, 'FAVORITE_PROFILE_NOTICE_LOG_FAILED');
  assert.equal(h.calls.writes.length, 0);
  assert.equal(h.calls.scans.length, 0);
});
