import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isCompletedPendingFromPreviousDay,
  learnPrintDuration,
  learnPrintDurationsFromRuns,
  printRecordDurationSeconds,
  printRewardPointsPending,
  removeUncreditedPrintFile,
  shouldStopRewardVerification
} from '../src/finishPrintMonitor.js';

test('detecta una impresión completada pendiente de un día anterior', () => {
  const pending = {
    printId: 'print-1',
    startedAt: '2026-09-24T17:15:10.349Z',
    timezone: 'Europe/Madrid',
    printRecord: { completed: true }
  };

  assert.equal(isCompletedPendingFromPreviousDay(pending, new Date('2026-09-25T07:13:31.000Z')), true);
  assert.equal(isCompletedPendingFromPreviousDay({
    ...pending,
    startedAt: '2026-09-25T06:15:10.349Z'
  }, new Date('2026-09-25T07:13:31.000Z')), false);
  assert.equal(isCompletedPendingFromPreviousDay({
    ...pending,
    printRecord: { completed: false }
  }, new Date('2026-09-25T07:13:31.000Z')), false);
});

test('limita a tres intentos la verificación de recompensa de una impresión terminada', () => {
  assert.equal(shouldStopRewardVerification({ completed: true }, 2), false);
  assert.equal(shouldStopRewardVerification({ completed: true }, 3), true);
  assert.equal(shouldStopRewardVerification({ completed: false }, 20), false);
});

test('desmarca solo el G-code sin recompensa y reconstruye la bolsa', () => {
  const finishPrint = {
    cloudFiles: ['bueno.gcode', 'fallido.gcode'],
    cloudFileRecords: [
      { id: 'good', name: 'bueno.gcode' },
      { id: 'bad', name: 'fallido.gcode' }
    ],
    shuffleBag: ['fallido.gcode', 'bueno.gcode', 'fallido.gcode'],
    shuffleBagCursor: 1
  };

  removeUncreditedPrintFile(finishPrint, { id: 'bad', name: 'fallido.gcode' }, () => 0);

  assert.deepEqual(finishPrint.cloudFiles, ['bueno.gcode']);
  assert.deepEqual(finishPrint.cloudFileRecords, [{ id: 'good', name: 'bueno.gcode' }]);
  assert.deepEqual(finishPrint.shuffleBag, ['bueno.gcode', 'bueno.gcode', 'bueno.gcode']);
  assert.equal(finishPrint.shuffleBagCursor, 0);
});

test('aprende la duración real tras la primera impresión completada', () => {
  const finishPrint = {
    cloudFileRecords: [{ id: 'gcode-1', name: 'Prueba.gcode', printTime: 0 }]
  };
  const file = { id: 'gcode-1', name: 'Prueba.gcode' };

  assert.equal(learnPrintDuration(finishPrint, file, {
    printStartTime: 1_790_000_000,
    printEndTime: 1_790_000_754,
    printJobTime: 700
  }), 754);
  assert.equal(finishPrint.cloudFileRecords[0].printTime, 754);
  assert.equal(file.printTime, 754);
});

test('conserva la duración proporcionada por Creality y admite timestamps en milisegundos', () => {
  const finishPrint = {
    cloudFileRecords: [{ id: 'gcode-1', name: 'Prueba.gcode', printTime: 900 }]
  };

  assert.equal(learnPrintDuration(finishPrint, { id: 'gcode-1', name: 'Prueba.gcode' }, {
    printStartTime: 1_790_000_000_000,
    printEndTime: 1_790_000_754_000
  }), 900);
  assert.equal(finishPrint.cloudFileRecords[0].printTime, 900);
  assert.equal(printRecordDurationSeconds({ printJobTime: 615 }), 615);
});

test('recupera duraciones de impresiones históricas completadas', () => {
  const finishPrint = {
    cloudFileRecords: [
      { id: 'gcode-1', name: 'Uno.gcode', printTime: 0 },
      { id: 'gcode-2', name: 'Dos.gcode', printTime: 300 }
    ]
  };
  const runs = [{
    taskId: 'finishPrint',
    details: {
      file: { id: 'gcode-1', name: 'Uno.gcode' },
      printRecord: { completed: true, printJobTime: 754 }
    }
  }, {
    taskId: 'finishPrint',
    details: {
      file: { id: 'gcode-2', name: 'Dos.gcode' },
      printRecord: { completed: true, printJobTime: 900 }
    }
  }];

  assert.equal(learnPrintDurationsFromRuns(finishPrint, runs), 1);
  assert.equal(finishPrint.cloudFileRecords[0].printTime, 754);
  assert.equal(finishPrint.cloudFileRecords[1].printTime, 300);
});

test('espera a que el saldo refleje los cinco puntos de la impresión', () => {
  const before = { pointsSummary: { total: 9000 } };
  assert.equal(printRewardPointsPending(before, { pointsSummary: { total: 9000 } }, 5), true);
  assert.equal(printRewardPointsPending(before, { pointsSummary: { total: 9005 } }, 5), false);
});
