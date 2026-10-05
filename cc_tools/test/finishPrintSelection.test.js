import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGcodeLibraryPayload,
  buildGcodeOwnerListPayload,
  buildGcodeQueryPayload,
  forwardAuthenticationHeaders,
  hasCrealityAuthentication,
  mergeDiscoveredPrinters,
  parseGcodeFiles,
  parseGcodeRecords,
  parseGcodeResponse,
  parseGcodeResponses,
  parsePrinterNames,
  parsePrinterResponse
} from '../src/finishPrintDiscovery.js';
import {
  buildPrintUsageHistory,
  buildPrintShuffleBag,
  countCreditedFinishPrintRun,
  incrementPrintUsage,
  isFinishPrintStartRun,
  normalizeGcodeFiles,
  normalizeGcodeRecords,
  selectNextPrintFile
} from '../src/finishPrintSelection.js';

test('detecta impresoras del Banco de trabajo por su estado', () => {
  const printers = parsePrinterNames('Dispositivos (3)\nHA Ender-3\nEn línea\nTaller\nOffline\nOctoPrint Virtual En línea');
  assert.deepEqual(printers, [{ name: 'HA Ender-3' }, { name: 'Taller' }, { name: 'OctoPrint Virtual' }]);
});

test('extrae impresoras de la respuesta estructurada del Banco de trabajo', () => {
  const printers = parsePrinterResponse({
    code: 0,
    result: {
      list: [{
        id: 'group-1',
        name: 'Sin grupo',
        deviceList: [
          { deviceId: 'printer-1', aliasName: 'OctoPrint Virtual', deviceName: 'Ender-3', connect: 1, idleState: 0, deviceType: { imageUrl: '//cdn.crealitycloud.com/printers/ender.png' } },
          { dn: 'printer-2', nickName: 'Taller', model: 'K1', connect: 0, idleState: 0 }
        ]
      }]
    }
  });

  assert.deepEqual(printers, [
    { name: 'OctoPrint Virtual', deviceId: 'printer-1', deviceName: 'Ender-3', telemetryId: '', deviceState: null, connectionState: 1, idleState: 0, model: 'Ender-3', imageUrl: 'https://cdn.crealitycloud.com/printers/ender.png', printerInterName: 'Ender-3', deviceType: null },
    { name: 'Taller', deviceId: 'printer-2', deviceName: 'printer-2', telemetryId: '', deviceState: null, connectionState: 0, idleState: 0, model: 'K1', imageUrl: '', printerInterName: 'K1', deviceType: null }
  ]);
});

test('no confunde los grupos con impresoras', () => {
  assert.deepEqual(parsePrinterResponse({ result: { list: [{ id: 'group-1', name: 'Taller', deviceList: [] }] } }), []);
});

test('extrae impresoras de la lista limitada del Banco de trabajo', () => {
  const printers = parsePrinterResponse({
    result: {
      deviceCount: 2,
      limitList: [
        { id: 'record-1', deviceId: 1709971, tbId: 'tb-one', deviceState: 1, connect: 1, idleState: 1, aliasName: 'Ender 3 V3 SE', deviceName: 'device-one', model: 'Ender-3 V3 SE', type: 5, deviceType: { internalName: 'Ender-3 V3 SE' } },
        { id: 'record-2', deviceId: 1752391, aliasName: 'Ender 3', deviceName: 'device-two', model: 'Ender-3', type: 5, deviceType: { internalName: 'Ender-3' } }
      ]
    },
    code: 0
  });

  assert.deepEqual(printers, [
    { name: 'Ender 3 V3 SE', deviceId: '1709971', deviceName: 'device-one', telemetryId: 'tb-one', deviceState: 1, connectionState: 1, idleState: 1, model: 'Ender-3 V3 SE', imageUrl: '', printerInterName: 'Ender-3 V3 SE', deviceType: 5 },
    { name: 'Ender 3', deviceId: '1752391', deviceName: 'device-two', telemetryId: '', deviceState: null, connectionState: null, idleState: null, model: 'Ender-3', imageUrl: '', printerInterName: 'Ender-3', deviceType: 5 }
  ]);
});

test('combina los endpoints sin fusionar dos impresoras del mismo modelo', () => {
  assert.deepEqual(mergeDiscoveredPrinters([
    { name: 'Raspberry', deviceId: 'printer-1', deviceName: 'Ender-3', model: 'Ender-3' },
    { name: 'Raspberry', deviceId: 'printer-1', deviceName: 'Ender-3', telemetryId: 'tb-1' },
    { name: 'Raspberry-2', deviceId: 'printer-2', deviceName: 'Ender-3', model: 'Ender-3' }
  ]), [
    { name: 'Raspberry', deviceId: 'printer-1', deviceName: 'Ender-3', model: 'Ender-3', telemetryId: 'tb-1' },
    { name: 'Raspberry-2', deviceId: 'printer-2', deviceName: 'Ender-3', model: 'Ender-3' }
  ]);
});

test('combina G-code estrictos y alternativos sin duplicados', () => {
  const files = parseGcodeResponse({
    result: {
      strictList: [{ id: 'g1', name: 'Taza.gcode' }],
      alternativeList: [
        { id: 'g2', name: 'Home Assistant.gcode' },
        { id: 'g1', name: 'Taza.gcode' },
        { id: 'txt', name: 'notas.txt' }
      ]
    }
  });

  assert.deepEqual(files, ['Taza.gcode', 'Home Assistant.gcode']);
});

test('combina las páginas adicionales de G-code sin duplicados', () => {
  assert.deepEqual(parseGcodeResponses([
    { result: { alternativeList: [{ id: '1', name: 'Uno.gcode' }] } },
    { result: { list: [{ id: '2', name: 'Dos.gcode' }, { id: '1', name: 'Uno.gcode' }] } }
  ]), ['Uno.gcode', 'Dos.gcode']);
});

test('conserva los identificadores necesarios para iniciar la impresión', () => {
  assert.deepEqual(parseGcodeRecords([
    { result: { strictList: [{ id: 'gcode-1', name: 'Prueba.gcode', printTime: 754 }] } }
  ]), [{ id: 'gcode-1', name: 'Prueba.gcode', printTime: 754 }]);
  assert.deepEqual(normalizeGcodeRecords([
    { id: 'gcode-1', name: 'Prueba.gcode', printTime: 754 },
    { id: 'gcode-1', name: 'Duplicado.gcode' },
    { id: '', name: 'Sin id.gcode' }
  ]), [{ id: 'gcode-1', name: 'Prueba.gcode', printTime: 754 }]);
});

test('reproduce los parámetros aceptados por la consulta oficial de G-code', () => {
  assert.deepEqual(buildGcodeQueryPayload({
    printerInterName: ' Ender-3 ',
    deviceType: '5'
  }), {
    printerInterName: 'Ender-3',
    pageSize: 3,
    state: 1,
    deviceType: 5,
    isUpload: true
  });
});

test('consulta la galería completa con la paginación oficial', () => {
  assert.deepEqual(buildGcodeLibraryPayload(2), { page: 2, pageSize: 12 });
  assert.deepEqual(buildGcodeLibraryPayload(0), { page: 1, pageSize: 12 });
});

test('reproduce la paginación oficial de G-code compatibles y alternativos', () => {
  const common = { page: 2, printerInterName: 'Ender-3', strictPrinterId: '20' };
  assert.deepEqual(buildGcodeOwnerListPayload({ ...common, alternative: false }), {
    pageSize: 3,
    page: 2,
    state: 1,
    isUpload: true,
    type: 1,
    deviceId: '20',
    printerInterName: 'Ender-3'
  });
  assert.deepEqual(buildGcodeOwnerListPayload({ ...common, alternative: true }), {
    pageSize: 3,
    page: 2,
    state: 1,
    isUpload: true,
    type: 1,
    exPrinterId: '20'
  });
});

test('reutiliza cabeceras de autenticación sin reenviar cabeceras controladas por el navegador', () => {
  assert.deepEqual(forwardAuthenticationHeaders({
    authorization: 'Bearer example',
    token: 'example-token',
    cookie: 'session=private',
    origin: 'https://www.crealitycloud.com',
    'content-type': 'application/json',
    'sec-fetch-site': 'same-origin',
    'x-app-version': '11'
  }), {
    authorization: 'Bearer example',
    token: 'example-token',
    'x-app-version': '11'
  });
});

test('acepta cualquier petición de API con la sesión autenticada de Creality', () => {
  assert.equal(hasCrealityAuthentication({
    __cxy_token_: 'token',
    __cxy_uid_: '7963944884'
  }), true);
  assert.equal(hasCrealityAuthentication({ __cxy_uid_: '7963944884' }), false);
});

test('detecta y deduplica archivos G-code visibles', () => {
  assert.deepEqual(
    parseGcodeFiles('Cargas\ncubo.gcode\nEnder-3\ncubo.gcode\nbenchy.gcode'),
    ['cubo.gcode', 'benchy.gcode']
  );
});

test('el modo aleatorio mezcla tres usos de cada archivo por ciclo', () => {
  const bag = buildPrintShuffleBag(['a.gcode', 'b.gcode'], () => 0.5);
  assert.equal(bag.length, 6);
  assert.equal(bag.filter((file) => file === 'a.gcode').length, 3);
  assert.equal(bag.filter((file) => file === 'b.gcode').length, 3);
});

test('la selección avanza y vuelve a mezclar al agotar la bolsa', () => {
  const first = selectNextPrintFile({ cloudFiles: ['a.gcode'], shuffleBag: [], shuffleBagCursor: 0 }, () => 0);
  assert.equal(first.file, 'a.gcode');
  assert.equal(first.shuffleBag.length, 3);
  const renewed = selectNextPrintFile({ cloudFiles: ['a.gcode'], shuffleBag: first.shuffleBag, shuffleBagCursor: 3 }, () => 0);
  assert.equal(renewed.file, 'a.gcode');
  assert.equal(renewed.shuffleBagCursor, 1);
});

test('el modo en orden recorre los G-code y vuelve a empezar', () => {
  const config = { cloudFiles: ['a.gcode', 'b.gcode'], printMode: 'ordered', shuffleBag: [], shuffleBagCursor: 0 };
  const first = selectNextPrintFile(config);
  const second = selectNextPrintFile({ ...config, shuffleBag: first.shuffleBag, shuffleBagCursor: first.shuffleBagCursor });
  const renewed = selectNextPrintFile({ ...config, shuffleBag: second.shuffleBag, shuffleBagCursor: second.shuffleBagCursor });
  assert.deepEqual([first.file, second.file, renewed.file], ['a.gcode', 'b.gcode', 'a.gcode']);
});

test('el modo cantidades respeta la cantidad y el orden de cada G-code', () => {
  const bag = buildPrintShuffleBag({
    printMode: 'quantities',
    cloudFiles: ['a.gcode', 'b.gcode'],
    cloudFileRecords: [
      { id: 'a', name: 'a.gcode', quantity: 2 },
      { id: 'b', name: 'b.gcode', quantity: 1 }
    ]
  });
  assert.deepEqual(bag, ['a.gcode', 'a.gcode', 'b.gcode']);
});

test('solo conserva nombres G-code válidos y únicos', () => {
  assert.deepEqual(normalizeGcodeFiles([' a.gcode ', 'a.gcode', 'nota.txt']), ['a.gcode']);
});

test('incrementa y conserva el contador histórico por identificador de G-code', () => {
  const finishPrint = { fileUsageCounts: { 'gcode-1': 49 } };
  assert.equal(incrementPrintUsage(finishPrint, { id: 'gcode-1', name: 'Prueba.gcode' }), 50);
  assert.equal(incrementPrintUsage(finishPrint, { id: 'gcode-1', name: 'Prueba.gcode' }), 51);
  assert.deepEqual(finishPrint.fileUsageCounts, { 'gcode-1': 51 });
});

test('reconstruye el historial de impresiones aceptadas sin contar verificaciones duplicadas', () => {
  const runs = [
    { taskId: 'finishPrint', status: 'success', details: { printId: 'print-1', file: { id: 'gcode-1', name: 'Uno.gcode' } } },
    { taskId: 'finishPrint', status: 'success', details: { printId: 'print-2', file: { id: 'gcode-1', name: 'Uno.gcode' } } },
    { taskId: 'finishPrint', status: 'success', details: { printRecord: { printId: 'print-1' }, file: { id: 'gcode-1', name: 'Uno.gcode' } } },
    { taskId: 'finishPrint', status: 'failed', details: { printId: 'print-3', file: { id: 'gcode-2', name: 'Dos.gcode' } } }
  ];
  assert.deepEqual(buildPrintUsageHistory(runs), { 'gcode-1': 2 });
});

test('el contador diario solo suma impresiones terminadas con recompensa verificada', () => {
  const base = {
    taskId: 'finishPrint',
    status: 'success',
    details: {
      printRecord: { completed: true },
      rewardVerification: { status: 'credited' }
    }
  };

  assert.equal(countCreditedFinishPrintRun(base), 1);
  assert.equal(countCreditedFinishPrintRun({
    ...base,
    details: { ...base.details, rewardVerification: { status: 'already_completed' } }
  }), 0);
  assert.equal(countCreditedFinishPrintRun({
    ...base,
    details: { ...base.details, rewardVerification: { status: 'not_credited' } }
  }), 0);
  assert.equal(countCreditedFinishPrintRun({
    ...base,
    details: { printId: 'print-started', rewardVerification: { status: 'pending' } }
  }), 0);
});

test('distingue el inicio programado del registro final de verificación', () => {
  assert.equal(isFinishPrintStartRun({
    taskId: 'finishPrint',
    source: 'schedule',
    details: { printId: 'print-1' }
  }), true);
  assert.equal(isFinishPrintStartRun({
    taskId: 'finishPrint',
    source: 'schedule',
    details: { failures: [{ code: 'FINISH_PRINT_TASK_REJECTED' }] }
  }), true);
  assert.equal(isFinishPrintStartRun({
    taskId: 'finishPrint',
    source: 'schedule',
    details: { printRecord: { printId: 'print-1', completed: true } }
  }), false);
  assert.equal(isFinishPrintStartRun({
    taskId: 'finishPrint',
    source: 'schedule',
    details: {
      printId: 'print-1',
      printRecord: { printId: 'print-1', completed: false },
      failures: [{ code: 'FINISH_PRINT_VERIFICATION_ERROR' }]
    }
  }), false);
});
