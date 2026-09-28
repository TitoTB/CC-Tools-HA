import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseCandidates,
  compareIncentiveProgress,
  isLikeControlActive
} from '../src/modelActionTask.js';
import {
  analyzeActionResponses,
  analyzeActionTrace,
  findIncentiveTaskRecord,
  incentivePageNotReadyError,
  normalizeTaskTitle,
  progressFromIncentiveTaskRecord,
  readIncentiveProgress
} from '../src/incentiveTasks.js';

test('identifica un punto acreditado después de realizar la acción', () => {
  const result = compareIncentiveProgress(
    progress(0, 1),
    progress(1, 1)
  );
  assert.equal(result.status, 'credited');
});

test('distingue una acción completada sin punto acreditado', () => {
  const result = compareIncentiveProgress(
    progress(0, 1),
    progress(0, 1)
  );
  assert.equal(result.status, 'not_credited');
});

test('detecta que la recompensa diaria ya estaba completada', () => {
  const result = compareIncentiveProgress(
    progress(1, 1),
    progress(1, 1)
  );
  assert.equal(result.status, 'already_completed');
});

test('no inventa el estado de la recompensa si falta el bloque de incentivos', () => {
  const result = compareIncentiveProgress(
    { found: false },
    progress(1, 1)
  );
  assert.equal(result.status, 'unverified');
});

test('detecta un me gusta aplicado previamente por la clase activa', () => {
  assert.equal(isLikeControlActive({ className: 'liked flex-all-center active' }), true);
});

test('detecta un me gusta aplicado previamente por accesibilidad', () => {
  assert.equal(isLikeControlActive({ className: 'liked flex-all-center', ariaPressed: 'true' }), true);
});

test('no confunde el contador de me gusta con un me gusta propio activo', () => {
  assert.equal(isLikeControlActive({
    className: 'liked flex-all-center',
    text: '27',
    html: '<div class="liked flex-all-center"><i class="iconfont icon-dianzan"></i><span>27</span></div>'
  }), false);
});

test('prioriza favoritos o los omite según la configuración de likes', () => {
  const favorite = {
    id: 'favorite',
    url: 'https://example.test/favorite',
    favoriteActive: true,
    favoriteProfileId: '42'
  };
  const downloaded = { id: 'downloaded', url: 'https://example.test/downloaded', indexedOnly: false };
  const indexed = { id: 'indexed', url: 'https://example.test/indexed', indexedOnly: true };
  const designs = [downloaded, indexed, favorite];

  assert.deepEqual(
    chooseCandidates(designs, 'likeCompleted', 'likeActionState', '', true, () => 0),
    [favorite, indexed, downloaded]
  );
  assert.deepEqual(
    chooseCandidates(designs, 'likeCompleted', 'likeActionState', '', false, () => 0),
    [downloaded]
  );
});

test('registra una petición mutadora aceptada por Creality Cloud', () => {
  const result = analyzeActionResponses([
    { method: 'POST', status: 200, url: 'https://www.crealitycloud.com/api/collect', body: '{"success":true}' }
  ], 'add_to_collection');
  assert.equal(result.observed, true);
  assert.equal(result.accepted, true);
  assert.equal(result.rejected, false);
});

test('distingue un rechazo funcional aunque la respuesta sea HTTP 200', () => {
  const result = analyzeActionResponses([
    { method: 'POST', status: 200, url: 'https://www.crealitycloud.com/api/collect', body: '{"success":false,"code":403}' }
  ], 'add_to_collection');
  assert.equal(result.observed, true);
  assert.equal(result.accepted, false);
  assert.equal(result.rejected, true);
});

test('no confunde el fallo de una petición de telemetría con el rechazo de la acción', () => {
  const result = analyzeActionResponses([
    { method: 'POST', status: 403, url: 'https://analytics.example.test/events', body: '{"success":false}' },
    { method: 'POST', status: 200, url: 'https://www.crealitycloud.com/api/collect', body: '{"success":true}' }
  ], 'add_to_collection');
  assert.equal(result.accepted, true);
  assert.equal(result.rejected, false);
});

test('ignora el fallo de Google Analytics aunque su endpoint contenga collect', () => {
  const result = analyzeActionTrace({
    responses: [{
      method: 'POST',
      status: 200,
      url: 'https://www.crealitycloud.com/api/cxy/v3/collection/addModelToFolders',
      body: '{"code":0,"msg":"ok"}'
    }],
    failedRequests: [{
      method: 'POST',
      resourceType: 'fetch',
      url: 'https://region1.analytics.google.com/g/collect?v=2',
      error: 'net::ERR_ABORTED'
    }]
  }, 'add_to_collection');

  assert.equal(result.code, 'ACTION_ENDPOINT_ACCEPTED');
  assert.equal(result.accepted, true);
  assert.equal(result.failedRequests.length, 0);
});

test('solo confirma cooldown ante una señal explícita de límite', () => {
  const result = analyzeActionTrace({
    responses: [{
      method: 'POST',
      status: 429,
      url: 'https://www.crealitycloud.com/api/collect',
      headers: { 'retry-after': '600' },
      body: '{"message":"Too many requests"}'
    }],
    failedRequests: []
  }, 'add_to_collection');
  assert.equal(result.code, 'RATE_LIMIT_CONFIRMED');
  assert.equal(result.cooldownConfirmed, true);
  assert.equal(result.retryAfter, '600');
});

test('una respuesta aceptada no se etiqueta como cooldown', () => {
  const result = analyzeActionTrace({
    responses: [{
      method: 'POST',
      status: 200,
      url: 'https://www.crealitycloud.com/api/collect',
      headers: {},
      body: '{"success":true}'
    }],
    failedRequests: []
  }, 'add_to_collection');
  assert.equal(result.code, 'ACTION_ENDPOINT_ACCEPTED');
  assert.equal(result.cooldownConfirmed, false);
});

test('distingue una petición de acción que falla sin respuesta', () => {
  const result = analyzeActionTrace({
    responses: [],
    failedRequests: [{
      method: 'POST',
      url: 'https://www.crealitycloud.com/api/collect',
      error: 'NS_ERROR_NET_TIMEOUT'
    }]
  }, 'add_to_collection');
  assert.equal(result.code, 'NETWORK_FAILURE');
  assert.equal(result.systemic, false);
});

test('distingue una confirmación de descarga cancelada de un cooldown', () => {
  const result = analyzeActionTrace({
    responses: [{
      method: 'POST',
      status: 200,
      url: 'https://www.crealitycloud.com/api/cxy/v3/model/3mfDownload',
      headers: {},
      body: '{"code":0,"msg":"ok"}'
    }],
    failedRequests: [{
      method: 'POST',
      url: 'https://www.crealitycloud.com/api/cxy/v3/model/3mfDownloadSuccess',
      error: 'NS_BINDING_ABORTED'
    }]
  }, 'download_model');

  assert.equal(result.code, 'DOWNLOAD_CONFIRMATION_ABORTED');
  assert.equal(result.cooldownConfirmed, false);
});

test('ignora la cancelación normal de la navegación que Chromium convierte en descarga', () => {
  const result = analyzeActionTrace({
    responses: [{
      method: 'POST',
      status: 200,
      url: 'https://www.crealitycloud.com/api/cxy/v3/model/3mfDownloadSuccess',
      headers: {},
      body: '{"code":0,"msg":"ok"}'
    }],
    failedRequests: [{
      method: 'GET',
      resourceType: 'document',
      url: 'https://internal-creality.example/file3mf/model.3mf',
      error: 'net::ERR_ABORTED'
    }]
  }, 'download_model');

  assert.equal(result.code, 'ACTION_ENDPOINT_ACCEPTED');
  assert.equal(result.failedRequests.length, 0);
});

test('recupera el taskId oficial de Collection Models en respuestas anidadas', () => {
  const match = findIncentiveTaskRecord({
    code: 0,
    result: {
      list: [{ taskId: 'collection-task-123', taskName: 'Collection Models' }]
    }
  }, 'Collection Models');

  assert.equal(match.taskId, 'collection-task-123');
});

test('lee el progreso de Collection Models desde la respuesta estructurada', () => {
  const progress = progressFromIncentiveTaskRecord({
    taskId: 'collection-task-123',
    taskName: 'Collection Models',
    doneTimes: 0,
    vaildTimes: 1
  }, 'Collection Models', { source: 'task-response' });

  assert.equal(progress.found, true);
  assert.equal(progress.taskId, 'collection-task-123');
  assert.equal(progress.done, 0);
  assert.equal(progress.valid, 1);
  assert.equal(progress.completed, false);
  assert.equal(progress.taskResolution, 'task-response');
});

test('acepta una tarea estructurada ya completada', () => {
  const progress = progressFromIncentiveTaskRecord({
    taskName: 'Collection Models',
    doneTimes: '1',
    validTimes: '1'
  }, 'Collection Models');

  assert.equal(progress.completed, true);
});

test('usa la API de tareas aunque Creality redirija la página de incentivos a la portada', async () => {
  const locator = (selector) => ({
    innerText: async () => selector === 'body'
      ? 'Creality Cloud home page with enough content to be considered fully loaded.'
      : '',
    first: () => ({
      isVisible: async () => false,
      waitFor: async () => {}
    })
  });
  const page = {
    goto: async () => {},
    url: () => 'https://www.crealitycloud.com/es',
    title: async () => 'Creality Cloud',
    frames: () => [],
    locator,
    waitForTimeout: async () => {},
    on: () => {},
    off: () => {},
    evaluate: async () => ({
      ok: true,
      status: 200,
      body: {
        code: 0,
        result: {
          list: [{
            taskId: 'collection-task-123',
            taskName: 'Collection Models',
            doneTimes: 0,
            vaildTimes: 1
          }]
        }
      }
    })
  };
  const observer = { snapshot: async () => [] };

  const progress = await readIncentiveProgress(page, observer, 'Collection Models', {
    includePoints: false,
    requireTaskList: true
  });

  assert.equal(progress.found, true);
  assert.equal(progress.done, 0);
  assert.equal(progress.valid, 1);
  assert.equal(progress.taskResolution, 'task-response');
});

test('no confunde otra tarea diaria con Collection Models', () => {
  const match = findIncentiveTaskRecord({
    result: { list: [{ taskId: 'like-task', taskName: 'Like 3D Model' }] }
  }, 'Collection Models');

  assert.equal(match, null);
});

test('normaliza títulos de tareas con contadores y espacios invisibles', () => {
  assert.equal(normalizeTaskTitle('Download Models\u00a00/30'), 'download models');
  assert.equal(normalizeTaskTitle('Download Models'), 'download models');
  assert.equal(normalizeTaskTitle('Like\u200b 3D Model'), 'like 3d model');
});

test('marca una página de incentivos vacía para reintento silencioso', () => {
  const error = incentivePageNotReadyError();

  assert.equal(error.code, 'INCENTIVE_PAGE_NOT_READY');
  assert.equal(error.silentRetry, true);
  assert.equal(error.systemic, false);
});

function progress(done, valid) {
  return {
    found: true,
    done,
    valid,
    completed: valid > 0 && done >= valid
  };
}
