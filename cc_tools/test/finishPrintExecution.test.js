import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPrintCheckPayload,
  buildSelectDeviceUrl,
  buildPrintTaskPayload,
  parsePrintRecord,
  validatePrintCheck,
  validatePrintTask
} from '../src/finishPrintExecution.js';

test('reproduce los payloads oficiales para validar e iniciar una impresión', () => {
  assert.deepEqual(buildPrintCheckPayload({ deviceName: ' printer-dn ', gcodeId: ' gcode-1 ' }), {
    dn: 'printer-dn',
    selectedGcodeId: 'gcode-1'
  });
  assert.deepEqual(buildPrintTaskPayload({
    deviceName: 'printer-dn',
    gcodeId: 'gcode-1',
    fileName: 'Prueba.gcode'
  }), {
    taskName: 'Prueba.gcode',
    deviceName: 'printer-dn',
    printCount: 1,
    gcodeId: 'gcode-1'
  });
});

test('abre la selección de dispositivo para el G-code concreto', () => {
  assert.equal(
    buildSelectDeviceUrl(' gcode/1 '),
    'https://www.crealitycloud.com/es/workbench-beta/select-device/gcode%2F1?type=1'
  );
});

test('detecta una impresión oficialmente finalizada', () => {
  assert.deepEqual(parsePrintRecord({
    code: 0,
    result: {
      id: 'print-1',
      gcodeId: 'gcode-1',
      name: 'Prueba.gcode',
      printState: 2,
      printErr: 0,
      printJobTime: 730,
      printStartTime: 100,
      printEndTime: 830
    }
  }), {
    printId: 'print-1',
    gcodeId: 'gcode-1',
    name: 'Prueba.gcode',
    printState: 2,
    printError: 0,
    printErrorDetail: '',
    printJobTime: 730,
    printStartTime: 100,
    printEndTime: 830,
    completed: true,
    failed: false,
    active: false,
    paused: false,
    stateLabel: 'Finalizada',
    diagnostics: {
      printState: 2,
      printError: 0,
      printErrorDetail: '',
      printStartTime: 100,
      printEndTime: 830,
      printJobTime: 730,
      deviceName: '',
      deviceType: null,
      model: ''
    }
  });
});

test('identifica estados pausados, detenidos y finales alternativos', () => {
  const paused = parsePrintRecord({ code: 0, result: { id: 'one', printState: 5, printEndTime: 0 } });
  assert.equal(paused.active, true);
  assert.equal(paused.paused, true);
  assert.equal(paused.completed, false);

  const stopped = parsePrintRecord({ code: 0, result: { id: 'two', printState: 4, printErr: 1 } });
  assert.equal(stopped.failed, true);
  assert.equal(stopped.completed, false);

  const alternate = parsePrintRecord({
    code: 0,
    result: { id: 'three', printState: 0, printStartTime: 100, printEndTime: 200 }
  });
  assert.equal(alternate.completed, true);
});

test('conserva la descripción del error devuelta por Creality Cloud', () => {
  const record = parsePrintRecord({
    code: 0,
    result: { id: 'failed', printState: 3, printErr: 17, failReason: 'Filamento agotado' }
  });
  assert.equal(record.printError, 17);
  assert.equal(record.printErrorDetail, 'Filamento agotado');
});

test('solo acepta un G-code marcado como imprimible', () => {
  assert.deepEqual(validatePrintCheck({ code: 0, result: { printable: 1 } }), { printable: 1 });
  assert.throws(
    () => validatePrintCheck({ code: 0, result: { printable: 0 } }),
    (error) => error.code === 'FINISH_PRINT_NOT_PRINTABLE'
  );
});

test('solo confirma trabajos aceptados con información de impresión y tarea', () => {
  assert.deepEqual(validatePrintTask({
    code: 0,
    result: {
      errCode: 0,
      printInfo: { id: 'print-1' },
      taskInfo: { taskId: 'task-1', taskName: 'Prueba.gcode' }
    }
  }), {
    printId: 'print-1',
    taskId: 'task-1',
    taskName: 'Prueba.gcode'
  });
  assert.throws(
    () => validatePrintTask({ code: 0, result: { errCode: 4 } }),
    (error) => error.code === 'FINISH_PRINT_TASK_REJECTED'
  );
});
