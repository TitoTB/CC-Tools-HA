import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHomeAssistantEvents,
  buildHomeAssistantState,
  internalTaskId
} from '../src/homeAssistantApi.js';

test('crea una instantánea estable para Home Assistant', () => {
  const config = fixtureConfig();
  const runs = [{
    id: 'run-print',
    taskId: 'finishPrint',
    status: 'success',
    source: 'schedule',
    createdAt: new Date().toISOString(),
    details: { printId: 'print-1', printerProfileId: 'ender-3', file: { name: 'pieza.gcode' } }
  }];
  const state = buildHomeAssistantState({
    config,
    runs,
    scheduler: { running: true, runningTask: 'modelDownloads' },
    browser: { active: true, mode: 'automation' },
    dailyCounters: { finishPrint: 1, modelDownloads: 2 },
    nextExecutions: { modelDownloads: '2026-09-27T10:00:00.000Z' },
    health: { state: 'active', successRate: 100 }
  });

  assert.equal(state.apiVersion, 1);
  assert.equal(state.account.name, 'Aguacatec');
  assert.equal(state.tasks.downloads.dailyCount, 2);
  assert.equal(state.scheduler.runningTask, 'downloads');
  assert.equal(state.printers[0].lastGcode, 'pieza.gcode');
  assert.equal(state.orders.pending, 1);
  assert.equal(state.orders.latest.status, 'Pendiente');
  assert.equal(state.orders.latest.title, 'Producto');
});

test('convierte ejecuciones en eventos deduplicables', () => {
  const events = buildHomeAssistantEvents([
    {
      id: 'order-1', taskId: 'shopOrders', status: 'success', source: 'schedule',
      message: 'Pedido enviado', createdAt: '2026-09-27T10:00:00.000Z',
      details: { order: { id: '42', title: 'Filamento', status: 'Enviado' } }
    },
    {
      id: 'download-1', taskId: 'modelDownloads', status: 'failed', source: 'schedule',
      message: 'Falló', createdAt: '2026-09-27T09:00:00.000Z', details: {}
    },
    { id: 'ignored', taskId: 'favoriteProfiles', status: 'success', details: {} }
  ]);

  assert.deepEqual(events.map((event) => event.type), ['order_shipped', 'task_failed']);
  assert.equal(events[0].related.title, 'Filamento');
  assert.equal(events[1].task, 'downloads');
});

test('solo emite la finalización verificada de una impresión', () => {
  const events = buildHomeAssistantEvents([
    {
      id: 'print-completed', taskId: 'finishPrint', status: 'success', source: 'schedule',
      message: 'Impresión verificada', createdAt: '2026-09-27T10:30:00.000Z',
      details: { file: { id: 'gcode-1', name: 'pieza.gcode' }, printRecord: { completed: true } }
    },
    {
      id: 'print-started', taskId: 'finishPrint', status: 'success', source: 'schedule',
      message: 'Impresión iniciada', createdAt: '2026-09-27T10:00:00.000Z',
      details: { file: { id: 'gcode-1', name: 'pieza.gcode' } }
    }
  ]);

  assert.equal(events.length, 1);
  assert.equal(events[0].id, 'print-completed');
  assert.equal(events[0].related.title, 'pieza.gcode');
});

test('traduce identificadores públicos de tareas', () => {
  assert.equal(internalTaskId('checkin'), 'creality');
  assert.equal(internalTaskId('likes'), 'modelLikes');
  assert.equal(internalTaskId('unknown'), '');
});

function fixtureConfig() {
  const task = (extra = {}) => ({
    enabled: true,
    dailyLimit: 1,
    lastRunAt: '',
    lastStatus: 'never',
    lastMessage: '',
    nextRunAt: '',
    ...extra
  });
  return {
    timezone: 'Europe/Madrid',
    setup: { assistantCompleted: true },
    crealityProfile: { userId: '7963944884', name: 'Aguacatec', avatarUrl: '' },
    points: { total: 1000, earnedToday: 10, status: 'current', updatedAt: '' },
    shopOrders: {
      items: [{
        id: '1', orderNumber: 'CC-1', title: 'Producto', status: 'Pendiente',
        statusKind: 'pending', points: 1200, quantity: 1,
        createdAt: '2026-09-27T10:00:00.000Z', archived: false
      }],
      updatedAt: ''
    },
    tasks: {
      creality: task(),
      finishPrint: task({
        printerProfiles: [{
          id: 'ender-3', printerName: 'Ender 3', dailyLimit: 10,
          cloudFiles: ['pieza.gcode'], cloudFileRecords: [{ name: 'pieza.gcode' }]
        }]
      }),
      modelDownloads: task({ dailyLimit: 30 }),
      comments: task({ dailyLimit: 6 }),
      modelBoosts: task({ availableBoosts: 2 }),
      modelLikes: task()
    }
  };
}
