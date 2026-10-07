import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceDownloadPlan,
  advanceFinishPrintPlan,
  boostAvailabilityRefreshDue,
  consumeManualDownloadSuccesses,
  delayPendingTaskPlan,
  executeWithTimeout,
  isGlobalBlockingIncident,
  recordCrealityServiceFailure,
  transientCrealityServiceFailure,
  updateAutomationHealth,
  updateModelBoostState,
  updateNextRunAfterExecution,
  parseRetryAfterMilliseconds
} from '../src/scheduler.js';

test('el watchdog libera recursos y devuelve un diagnóstico de timeout', async () => {
  let aborted = false;
  const pending = new Promise(() => {});

  await assert.rejects(
    executeWithTimeout(pending, {
      timeoutMs: 15,
      taskId: 'modelDownloads',
      source: 'schedule',
      onTimeout: () => { aborted = true; }
    }),
    (error) => {
      assert.equal(error.code, 'TASK_EXECUTION_TIMEOUT');
      assert.match(error.technical, /modelDownloads/);
      assert.match(error.technical, /Chromium se cerró/);
      return true;
    }
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(aborted, true);
});

test('el watchdog se cancela cuando la tarea termina a tiempo', async () => {
  const result = await executeWithTimeout(Promise.resolve('ok'), {
    timeoutMs: 100,
    taskId: 'modelDownloads',
    source: 'schedule'
  });
  assert.equal(result, 'ok');
});

test('interpreta Retry-After expresado en segundos sin reintentar', () => {
  assert.equal(parseRetryAfterMilliseconds('120', new Date('2026-09-20T10:00:00Z')), 120000);
});

test('un fallo sistémico aislado no detiene las descargas', () => {
  const config = { automationHealth: { state: 'active' } };
  const result = {
    details: {
      incident: {
        code: 'PAGE_INCOMPLETE',
        message: 'La página no terminó de cargar.',
        systemic: true
      }
    }
  };

  const event = updateAutomationHealth(config, 'modelLikes', 'failed', result);

  assert.equal(event.isolatedIncident, true);
  assert.equal(config.automationHealth.state, 'active');
  assert.equal(config.automationHealth.lastIncidentTaskId, 'modelLikes');
});

test('solo las incidencias globales confirmadas pueden detener el scheduler', () => {
  assert.equal(isGlobalBlockingIncident({ code: 'PAGE_INCOMPLETE' }), false);
  assert.equal(isGlobalBlockingIncident({ code: 'BROWSER_CLOSED' }), false);
  assert.equal(isGlobalBlockingIncident({ code: 'ACTION_CONFIRMED_REWARD_NOT_CREDITED' }), false);
  assert.equal(isGlobalBlockingIncident({ code: 'RATE_LIMIT_CONFIRMED' }), true);
  assert.equal(isGlobalBlockingIncident({ code: 'SECURITY_CHALLENGE' }), true);
  assert.equal(isGlobalBlockingIncident({ code: 'LOGIN_REQUIRED' }), true);
  assert.equal(isGlobalBlockingIncident({ code: 'CREALITY_SERVICE_UNAVAILABLE' }), true);
  assert.equal(isGlobalBlockingIncident({ reasonCode: 'SECURITY_CHALLENGE' }), true);
});

test('clasifica timeouts de navegación y errores 502 a 504 como indisponibilidad temporal', () => {
  assert.equal(transientCrealityServiceFailure({
    message: 'page.goto: Timeout 30000ms exceeded.'
  })?.code, 'CREALITY_SERVICE_UNAVAILABLE');
  assert.equal(transientCrealityServiceFailure({
    code: 'CREALITY_HTTP_ERROR',
    diagnostic: { httpStatus: 504 },
    message: 'Creality Cloud respondió con el estado HTTP 504.'
  })?.httpStatus, 504);
  assert.equal(transientCrealityServiceFailure({
    code: 'CREALITY_HTTP_ERROR',
    diagnostic: { httpStatus: 500 },
    message: 'Creality Cloud respondió con el estado HTTP 500.'
  }), null);
  assert.equal(transientCrealityServiceFailure({
    code: 'PAGE_INCOMPLETE',
    systemic: true,
    message: 'La página no terminó de cargar.'
  })?.code, 'CREALITY_SERVICE_UNAVAILABLE');
  assert.equal(transientCrealityServiceFailure({
    code: 'PAGE_INCOMPLETE',
    systemic: false,
    message: 'Una ficha concreta no terminó de cargar.'
  }), null);
  assert.equal(transientCrealityServiceFailure(null)?.code, 'CREALITY_SERVICE_UNAVAILABLE');
  assert.equal(transientCrealityServiceFailure({
    code: 'EMPTY_DOWNLOAD_ERROR',
    message: 'La descarga no devolvió información sobre el error.'
  })?.code, 'CREALITY_SERVICE_UNAVAILABLE');
});

test('confirma la caída al segundo fallo y aumenta progresivamente la espera', () => {
  const config = { automationHealth: { state: 'active' } };
  const failure = {
    code: 'CREALITY_SERVICE_UNAVAILABLE',
    message: 'Creality Cloud no está disponible temporalmente.'
  };
  const first = recordCrealityServiceFailure(
    config,
    'modelDownloads',
    failure,
    new Date('2026-10-06T16:40:00.000Z')
  );
  assert.equal(first.retryMinutes, 10);
  assert.equal(first.confirmed, false);
  assert.equal(first.notificationRequired, false);
  assert.equal(config.automationHealth.state, 'active');

  const second = recordCrealityServiceFailure(
    config,
    'finishPrint',
    failure,
    new Date('2026-10-06T16:52:00.000Z')
  );
  assert.equal(second.retryMinutes, 20);
  assert.equal(second.confirmed, true);
  assert.equal(second.notificationRequired, true);
  assert.equal(config.automationHealth.state, 'paused');

  const third = recordCrealityServiceFailure(
    config,
    'modelDownloads',
    failure,
    new Date('2026-10-06T17:02:00.000Z')
  );
  assert.equal(third.retryMinutes, 40);
  assert.equal(third.notificationRequired, false);
});

test('una ejecución correcta limpia la caída y solicita un único aviso de recuperación', () => {
  const config = {
    automationHealth: {
      state: 'paused',
      reasonCode: 'CREALITY_SERVICE_UNAVAILABLE',
      serviceFailureCount: 3,
      serviceUnavailableNotified: true
    }
  };

  const event = updateAutomationHealth(config, 'modelDownloads', 'success', { details: {} });
  assert.equal(event.recovered, true);
  assert.equal(config.automationHealth.state, 'active');
  assert.equal(config.automationHealth.serviceFailureCount, 0);
  assert.equal(config.automationHealth.serviceUnavailableNotified, false);
});

test('interpreta Retry-After expresado como fecha HTTP', () => {
  const delay = parseRetryAfterMilliseconds(
    'Sun, 20 Sep 2026 10:30:00 GMT',
    new Date('2026-09-20T10:00:00Z')
  );
  assert.equal(delay, 30 * 60 * 1000);
});

test('descarta un Retry-After no válido', () => {
  assert.equal(parseRetryAfterMilliseconds('más tarde'), null);
});

test('un fallo recuperable se reprograma una hora después dentro de la ventana', () => {
  const task = { windowStart: '08:00', windowEnd: '20:00' };
  const now = new Date('2026-09-20T10:00:00Z');

  updateNextRunAfterExecution(task, 'modelBoosts', 'schedule', {
    details: { retryableToday: true }
  }, now);

  const nextRunAt = new Date(task.nextRunAt);
  assert.ok(nextRunAt >= new Date('2026-09-20T11:00:00Z'));
  assert.ok(nextRunAt < new Date('2026-09-20T20:00:00Z'));
});

test('vuelve a consultar los boosts si el saldo diario guardado sigue a cero', () => {
  const now = new Date('2026-09-20T10:31:00Z');
  assert.equal(boostAvailabilityRefreshDue({
    timezone: 'UTC',
    availabilityDate: '2026-09-20',
    availabilityCheckedAt: '2026-09-20T10:00:00Z',
    availableBoosts: 0
  }, now), true);
  assert.equal(boostAvailabilityRefreshDue({
    timezone: 'UTC',
    availabilityDate: '2026-09-20',
    availabilityCheckedAt: '2026-09-20T10:00:00Z',
    availableBoosts: 3
  }, now), false);
});

test('un fallo previo a consultar boletos no borra el saldo de boosts conocido', () => {
  const config = { tasks: { modelBoosts: { availableBoosts: 3, availabilityDate: '2026-09-20' } } };

  updateModelBoostState(config, 'modelBoosts', {
    details: { boostConsumed: false, retryableToday: true }
  });

  assert.equal(config.tasks.modelBoosts.availableBoosts, 3);
});

test('una ejecución programada consume un único horario aunque falle', () => {
  const task = {
    downloadPlan: [
      '2026-09-21T08:00:00.000Z',
      '2026-09-21T08:30:00.000Z',
      '2026-09-21T09:00:00.000Z'
    ],
    downloadPlanCursor: 0,
    downloadPlanDoneCount: 0,
    nextRunAt: '2026-09-21T08:00:00.000Z'
  };

  advanceDownloadPlan(task);

  assert.equal(task.downloadPlanCursor, 1);
  assert.equal(task.downloadPlanDoneCount, 1);
  assert.equal(task.nextRunAt, '2026-09-21T08:30:00.000Z');
  assert.equal(task.downloadPlan.length, 3);
});

test('la última ejecución del plan no crea una tarea para el día siguiente', () => {
  const task = {
    downloadPlan: ['2026-09-21T08:00:00.000Z'],
    downloadPlanCursor: 0,
    downloadPlanDoneCount: 0,
    nextRunAt: '2026-09-21T08:00:00.000Z'
  };

  advanceDownloadPlan(task);

  assert.equal(task.downloadPlanCursor, 1);
  assert.equal(task.nextRunAt, '');
});

test('una descarga manual acreditada consume un horario y conserva el plan diario', () => {
  const task = {
    downloadPlan: [
      '2026-09-21T12:30:00.000Z',
      '2026-09-21T13:00:00.000Z',
      '2026-09-21T13:30:00.000Z'
    ],
    downloadPlanCursor: 0,
    downloadPlanDoneCount: 0,
    nextRunAt: '2026-09-22T08:00:00.000Z'
  };

  consumeManualDownloadSuccesses(task, 1);

  assert.equal(task.downloadPlanCursor, 1);
  assert.equal(task.downloadPlanDoneCount, 1);
  assert.equal(task.nextRunAt, '2026-09-21T13:00:00.000Z');
});

test('una prueba manual sin descarga no altera el siguiente horario', () => {
  const task = {
    downloadPlan: ['2026-09-21T13:00:00.000Z'],
    downloadPlanCursor: 0,
    downloadPlanDoneCount: 0,
    nextRunAt: '2026-09-21T13:00:00.000Z'
  };

  consumeManualDownloadSuccesses(task, 0);

  assert.equal(task.downloadPlanCursor, 0);
  assert.equal(task.nextRunAt, '2026-09-21T13:00:00.000Z');
});

test('una impresión consume un único horario del plan diario', () => {
  const task = {
    printPlan: [
      '2026-09-21T08:00:00.000Z',
      '2026-09-21T09:00:00.000Z'
    ],
    printPlanCursor: 0,
    printPlanDoneCount: 0,
    nextRunAt: '2026-09-21T08:00:00.000Z'
  };

  advanceFinishPrintPlan(task);

  assert.equal(task.printPlanCursor, 1);
  assert.equal(task.printPlanDoneCount, 1);
  assert.equal(task.nextRunAt, '2026-09-21T09:00:00.000Z');
});

test('un conflicto desplaza todo el tramo pendiente sin comprimir el plan', () => {
  const task = {
    downloadPlan: [
      '2026-09-21T08:00:00.000Z',
      '2026-09-21T08:22:00.000Z',
      '2026-09-21T08:44:00.000Z'
    ],
    downloadPlanCursor: 0,
    nextRunAt: '2026-09-21T08:00:00.000Z'
  };

  delayPendingTaskPlan(task, 'modelDownloads', '2026-09-21T08:20:00.000Z');

  assert.deepEqual(task.downloadPlan, [
    '2026-09-21T08:20:00.000Z',
    '2026-09-21T08:42:00.000Z',
    '2026-09-21T09:04:00.000Z'
  ]);
  assert.equal(task.nextRunAt, '2026-09-21T08:20:00.000Z');
});

test('solo desplaza las posiciones aún pendientes del plan', () => {
  const task = {
    printPlan: [
      '2026-09-21T08:00:00.000Z',
      '2026-09-21T09:00:00.000Z',
      '2026-09-21T10:00:00.000Z'
    ],
    printPlanCursor: 1,
    nextRunAt: '2026-09-21T09:00:00.000Z'
  };

  delayPendingTaskPlan(task, 'finishPrint', '2026-09-21T09:20:00.000Z');

  assert.deepEqual(task.printPlan, [
    '2026-09-21T08:00:00.000Z',
    '2026-09-21T09:20:00.000Z',
    '2026-09-21T10:20:00.000Z'
  ]);
});

test('una reprogramación puede extender el plan más allá de su ventana original', () => {
  const task = {
    windowStart: '08:00',
    windowEnd: '20:00',
    commentPlan: [
      '2026-09-21T19:50:00.000Z',
      '2026-09-21T20:12:00.000Z'
    ],
    commentPlanCursor: 0,
    nextRunAt: '2026-09-21T19:50:00.000Z'
  };

  delayPendingTaskPlan(task, 'comments', '2026-09-21T20:10:00.000Z');

  assert.deepEqual(task.commentPlan, [
    '2026-09-21T20:10:00.000Z',
    '2026-09-21T20:32:00.000Z'
  ]);
  assert.equal(task.nextRunAt, '2026-09-21T20:10:00.000Z');
});
