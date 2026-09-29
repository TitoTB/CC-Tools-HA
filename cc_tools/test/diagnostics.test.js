import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBrowserError } from '../src/browserManager.js';
import {
  generalizedIncident,
  inspectCrealityPage,
  isModelReviewFailureResponse,
  isSecurityChallengeResponse
} from '../src/crealityDiagnostics.js';

test('normaliza un perfil de Chromium bloqueado como incidencia sistémica', () => {
  const error = normalizeBrowserError(new Error('Failed to create a ProcessSingleton for your profile directory.'));
  assert.equal(error.code, 'BROWSER_PROFILE_LOCKED');
  assert.equal(error.systemic, true);
});

test('reconoce el mensaje de perfil en uso emitido por Chromium', () => {
  const error = normalizeBrowserError(new Error(
    'The profile appears to be in use by another Chromium process (33) on another computer.'
  ));
  assert.equal(error.code, 'BROWSER_PROFILE_LOCKED');
  assert.equal(error.systemic, true);
});

test('distingue un cierre inesperado de Chromium de un bloqueo del perfil', () => {
  const error = normalizeBrowserError(new Error('Target page, context or browser has been closed'));
  assert.equal(error.code, 'BROWSER_CLOSED');
  assert.equal(error.systemic, true);
});

test('una pestaña de Chromium caída se reintenta silenciosamente', () => {
  const error = normalizeBrowserError(new Error('page.waitForTimeout: Page crashed'));
  assert.equal(error.code, 'BROWSER_CRASHED');
  assert.equal(error.systemic, false);
  assert.equal(error.silentRetry, true);
  assert.match(error.technical, /Page crashed/);
});

test('distingue la ausencia de XServer de un perfil bloqueado', () => {
  const error = normalizeBrowserError(new Error('Missing X server or $DISPLAY'));
  assert.equal(error.code, 'DISPLAY_UNAVAILABLE');
  assert.equal(error.systemic, false);
});

test('dos timeouts de descarga consecutivos abren una incidencia general', () => {
  const incident = generalizedIncident([
    { code: 'DOWNLOAD_TIMEOUT', error: 'Primer timeout' },
    { code: 'DOWNLOAD_TIMEOUT', error: 'Segundo timeout' }
  ]);
  assert.equal(incident.code, 'REPEATED_DOWNLOAD_TIMEOUT');
  assert.equal(incident.systemic, true);
});

test('un modelo sin controles no pausa el resto de automatizaciones', () => {
  const incident = generalizedIncident([
    { code: 'MODEL_CONTROLS_NOT_FOUND', error: 'Sin controles' }
  ]);
  assert.equal(incident, null);
});

test('una tarea de incentivos ausente una sola vez no abre una incidencia general', () => {
  assert.equal(generalizedIncident([{
    code: 'INCENTIVE_TASK_NOT_FOUND',
    category: 'reward',
    systemic: false,
    error: 'No se encontró la tarea diaria "Download Models".'
  }]), null);
});

test('tres interfaces de descarga ausentes se consideran un fallo general', () => {
  const incident = generalizedIncident([
    { code: 'MODEL_CONTROLS_NOT_FOUND', error: 'Uno' },
    { code: 'MODEL_CONTROLS_NOT_FOUND', error: 'Dos' },
    { code: 'MODEL_CONTROLS_NOT_FOUND', error: 'Tres' }
  ]);
  assert.equal(incident.code, 'MODEL_INTERFACE_UNAVAILABLE');
});

test('un script normal de Cloudflare con redirección no es una verificación activa', () => {
  const challenge = isSecurityChallengeResponse({
    status: 302,
    url: 'https://www.crealitycloud.com/cdn-cgi/challenge-platform/scripts/jsd/main.js',
    resourceType: 'script',
    headers: {}
  });
  assert.equal(challenge, false);
});

test('una navegación de documento a una URL de desafío sí se detecta', () => {
  const challenge = isSecurityChallengeResponse({
    status: 302,
    url: 'https://www.crealitycloud.com/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1',
    resourceType: 'document',
    headers: {}
  });
  assert.equal(challenge, true);
});

test('la cabecera informativa de DataDome no se interpreta por sí sola como bloqueo', () => {
  const challenge = isSecurityChallengeResponse({
    status: 200,
    url: 'https://www.crealitycloud.com/es/model-detail/modelo-de-prueba',
    resourceType: 'document',
    headers: { 'x-datadome': 'protected' }
  });
  assert.equal(challenge, false);
});

test('una respuesta explícita de bloqueo de DataDome se registra como desafío', () => {
  const challenge = isSecurityChallengeResponse({
    status: 200,
    url: 'https://www.crealitycloud.com/api/model/action',
    resourceType: 'xhr',
    headers: { 'x-datadome-traffic-rule-response': 'BLOCK' }
  });
  assert.equal(challenge, true);
});

test('una ficha normal no falla aunque el observador haya visto el script de Cloudflare', async () => {
  const page = fakePage({
    url: 'https://www.crealitycloud.com/es/model-detail/modelo-de-prueba',
    title: 'Modelo de prueba | Creality Cloud',
    body: 'Modelo de prueba listo para imprimir. Ver archivos STL/CAD y añadir a la colección.'
  });
  const observer = {
    snapshot: async () => [{
      status: 302,
      url: 'https://www.crealitycloud.com/cdn-cgi/challenge-platform/scripts/jsd/main.js',
      resourceType: 'script',
      headers: {},
      challenge: false
    }]
  };

  assert.equal(await inspectCrealityPage(page, observer, { requireBody: true }), null);
});

test('una tarjeta externa con Just a moment no convierte una ficha normal en desafío', async () => {
  const page = fakePage({
    url: 'https://www.crealitycloud.com/es/model-detail/loki-3dprint-solutions?source=2',
    title: 'Loki | Creality Cloud',
    body: [
      'Loki user6278224487 Seguir Configuración de impresión Ver archivos STL/CAD',
      'Descripción Cuernos del Presidente Loki Original Just a moment...',
      'Comentarios Licencia Etiquetas Modelos relacionados',
      'Contenido adicional de una ficha cargada correctamente. '.repeat(35)
    ].join(' ')
  });
  const observer = { snapshot: async () => [] };

  assert.equal(await inspectCrealityPage(page, observer, { requireBody: true }), null);
});

test('reconoce la respuesta funcional de un modelo rechazado por revisión', () => {
  assert.equal(isModelReviewFailureResponse({
    url: 'https://www.crealitycloud.com/api/cxy/v3/model/modelGroupDetail',
    body: '{"code":1000069,"msg":"The model review failed."}'
  }), true);
});

test('un modelo rechazado prevalece sobre el 404 genérico de su ficha', async () => {
  const url = 'https://www.crealitycloud.com/es/model-detail/6ab25293629b8955fe02506b';
  const page = fakePage({ url, title: 'Creality Cloud', body: 'La página solicitada no está disponible actualmente.' });
  const observer = {
    snapshot: async () => [{
      status: 404,
      url,
      resourceType: 'document',
      headers: {}
    }, {
      status: 200,
      url: 'https://www.crealitycloud.com/api/cxy/v3/model/modelGroupDetail',
      resourceType: 'fetch',
      headers: { 'content-type': 'application/json' },
      body: '{"code":1000069,"msg":"The model review failed."}'
    }]
  };

  const result = await inspectCrealityPage(page, observer, { requireBody: true });
  assert.equal(result.code, 'MODEL_REVIEW_FAILED');
  assert.equal(result.systemic, false);
});

test('un modelo eliminado con HTTP 404 no se considera una incidencia general', async () => {
  const url = 'https://www.crealitycloud.com/es/model-detail/modelo-eliminado';
  const page = fakePage({ url, title: 'Creality Cloud', body: 'La página solicitada no está disponible actualmente.' });
  const observer = {
    snapshot: async () => [{
      status: 404,
      url,
      resourceType: 'document',
      headers: {}
    }]
  };

  const result = await inspectCrealityPage(page, observer, { requireBody: true });
  assert.equal(result.code, 'MODEL_NOT_FOUND');
  assert.equal(result.category, 'model');
  assert.equal(result.systemic, false);
});

function fakePage({ url, title, body }) {
  return {
    url: () => url,
    title: async () => title,
    frames: () => [{ url: () => url }],
    locator: (selector) => {
      if (selector === 'body') {
        return { innerText: async () => body };
      }
      return {
        first: () => ({ isVisible: async () => false })
      };
    }
  };
}
