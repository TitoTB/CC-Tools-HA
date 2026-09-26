import test from 'node:test';
import assert from 'node:assert/strict';
import { applyStartedVirtualPrint, manualVirtualPrintConfig } from '../src/finishPrintTask.js';

test('una impresión iniciada crea la verificación pendiente a cinco minutos', () => {
  const finishPrint = {
    timezone: 'Europe/Madrid',
    shuffleBag: [],
    shuffleBagCursor: 0,
    fileUsageCounts: {}
  };
  const startedAt = new Date('2026-09-23T08:00:00.000Z');
  const result = {
    details: {
      printId: 'print-1',
      taskId: 'task-1',
      file: { id: 'gcode-1', name: 'Prueba.gcode' },
      selection: {
        shuffleBag: ['Prueba.gcode', 'Prueba.gcode'],
        shuffleBagCursor: 1
      },
      rewardVerification: {
        before: { pointsSummary: { total: 100 } }
      }
    }
  };

  applyStartedVirtualPrint(finishPrint, result, 'schedule', startedAt);

  assert.equal(finishPrint.fileUsageCounts['gcode-1'], 1);
  assert.equal(finishPrint.shuffleBagCursor, 1);
  assert.deepEqual(finishPrint.pendingVerification, {
    printId: 'print-1',
    taskId: 'task-1',
    file: { id: 'gcode-1', name: 'Prueba.gcode' },
    source: 'schedule',
    timezone: 'Europe/Madrid',
    rewardBefore: { pointsSummary: { total: 100 } },
    startedAt: '2026-09-23T08:00:00.000Z',
    nextCheckAt: '2026-09-23T08:05:00.000Z',
    lastCheckedAt: '',
    verificationAttempts: 0
  });
});

test('una impresión manual utiliza únicamente la impresora y el G-code seleccionados', () => {
  const config = manualVirtualPrintConfig({
    timezone: 'Europe/Madrid',
    pendingVerification: null,
    cloudFiles: ['programado.gcode'],
    cloudFileRecords: [{ id: 'scheduled', name: 'programado.gcode' }]
  }, {
    printer: {
      name: 'Ender 3',
      deviceId: 'device-1',
      deviceName: 'Ender-3',
      printerInterName: 'octoprint-1',
      deviceType: 1
    },
    file: { id: 'manual', name: 'manual.gcode', printTime: 120 }
  });

  assert.equal(config.manualSelection, true);
  assert.equal(config.printerName, 'Ender 3');
  assert.equal(config.printerDeviceName, 'Ender-3');
  assert.deepEqual(config.cloudFiles, ['manual.gcode']);
  assert.deepEqual(config.cloudFileRecords, [{ id: 'manual', name: 'manual.gcode', printTime: 120 }]);
  assert.equal(config.pendingVerification, null);
});

test('la verificación conserva que la impresión fue seleccionada manualmente', () => {
  const finishPrint = { timezone: 'Europe/Madrid', fileUsageCounts: {} };
  applyStartedVirtualPrint(finishPrint, {
    details: {
      printId: 'print-manual',
      taskId: 'task-manual',
      file: { id: 'manual', name: 'manual.gcode' },
      printerName: 'Ender 3',
      manualSelection: true
    }
  }, 'manual', new Date('2026-09-25T12:00:00.000Z'));

  assert.equal(finishPrint.pendingVerification.manualSelection, true);
  assert.equal(finishPrint.pendingVerification.printerName, 'Ender 3');
});
