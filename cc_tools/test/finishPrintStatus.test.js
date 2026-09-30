import test from 'node:test';
import assert from 'node:assert/strict';
import {
  latestTimeseriesValue,
  looksLikePrinterLogin,
  mergeKnownPrinters,
  parsePrinterTelemetry,
  printerSessionTargetUrl,
  printerStateLabel,
  recordsByKey
} from '../src/finishPrintStatus.js';

test('distingue una sesión no iniciada de un fallo del Banco de trabajo', () => {
  assert.equal(looksLikePrinterLogin({ url: 'https://www.crealitycloud.com/es/login?redirect=workbench' }), true);
  assert.equal(looksLikePrinterLogin({ text: 'Creality Cloud\nIniciar sesión\nCrear cuenta' }), true);
  assert.equal(looksLikePrinterLogin({ text: 'Ender 3\nEn línea\nImprimir desde archivos en la nube' }), false);
});

test('usa un G-code configurado para activar la sesión autenticada del Banco de trabajo', () => {
  assert.equal(
    printerSessionTargetUrl([{ authenticationGcodeId: 'gcode/1' }]),
    'https://www.crealitycloud.com/es/workbench-beta/select-device/gcode%2F1?type=1'
  );
  assert.equal(
    printerSessionTargetUrl([]),
    'https://www.crealitycloud.com/en/workbench-beta/?type=1'
  );
});

test('combina las impresoras observadas con los identificadores guardados', () => {
  const printers = mergeKnownPrinters(
    [{ name: 'Ender 3', deviceName: 'Ender-3', deviceId: 'fresh-device', deviceState: 1, connectionState: 1, idleState: 1 }],
    [{ name: 'Ender 3', deviceName: 'Ender-3', deviceId: 'old-device', telemetryId: 'tb-1' }]
  );
  assert.deepEqual(printers, [{
    name: 'Ender 3',
    deviceName: 'Ender-3',
    deviceId: 'fresh-device',
    telemetryId: 'tb-1',
    imageUrl: '',
    deviceState: 1,
    connectionState: 1,
    idleState: 1
  }]);
});

test('mantiene separadas dos impresoras del mismo modelo con nombres e IDs distintos', () => {
  const printers = mergeKnownPrinters([
    { name: 'Raspberry', deviceName: 'Ender-3', deviceId: 'printer-1', connectionState: 1 },
    { name: 'Raspberry-2', deviceName: 'Ender-3', deviceId: 'printer-2', connectionState: 1 }
  ]);
  assert.deepEqual(printers.map((printer) => printer.name), ['Raspberry', 'Raspberry-2']);
  assert.deepEqual(printers.map((printer) => printer.deviceId), ['printer-1', 'printer-2']);
});

test('normaliza atributos y selecciona la muestra temporal más reciente', () => {
  assert.deepEqual(recordsByKey({ length: 0 }), {});
  assert.deepEqual(recordsByKey([{ key: 'state', value: 5 }, { key: 'printId', value: 'print-1' }]), {
    state: 5,
    printId: 'print-1'
  });
  assert.equal(latestTimeseriesValue({ printProgress: [
    { value: '20', ts: 10 },
    { value: '65', ts: 30 }
  ] }, 'printProgress'), '65');
});

test('muestra una impresora en reposo como inactiva', () => {
  assert.equal(printerStateLabel(0), 'Inactiva');
});

test('convierte la telemetría oficial en el estado mostrado por la interfaz', () => {
  const status = parsePrinterTelemetry(
    { name: 'Ender 3', telemetryId: 'tb-1', deviceState: 1, connectionState: 1 },
    { result: [
      { key: 'state', value: 5, lastUpdateTs: 300 },
      { key: 'err', value: 0, lastUpdateTs: 300 },
      { key: 'printId', value: 'print-1', lastUpdateTs: 300 },
      { key: 'print', value: 'pieza.gcode', lastUpdateTs: 300 }
    ] },
    { result: {
      printProgress: [{ value: '42', ts: 300 }],
      printJobTime: [{ value: '600', ts: 300 }],
      printLeftTime: [{ value: '900', ts: 300 }]
    } }
  );
  assert.equal(status.stateLabel, 'Pausada');
  assert.equal(status.paused, true);
  assert.equal(status.canStop, true);
  assert.equal(status.progress, 42);
  assert.equal(status.elapsedSeconds, 600);
  assert.equal(status.remainingSeconds, 900);
  assert.equal(status.gcodeName, 'pieza.gcode');
  assert.equal(status.printErrorDetail, '');
  assert.equal(printerStateLabel(17), 'Estado 17');
});

test('conserva el detalle textual de un error de impresión', () => {
  const status = parsePrinterTelemetry(
    { name: 'Ender 3', telemetryId: 'tb-1', deviceState: 3 },
    { result: [
      { key: 'state', value: 3, lastUpdateTs: 400 },
      { key: 'err', value: 17, lastUpdateTs: 400 },
      { key: 'errorMessage', value: 'Filamento agotado', lastUpdateTs: 400 }
    ] },
    { result: {} }
  );
  assert.equal(status.printError, 17);
  assert.equal(status.printErrorDetail, 'Filamento agotado');
});

test('no presenta un código técnico como si fuera la descripción del error', () => {
  const status = parsePrinterTelemetry(
    { name: 'Ender 3', telemetryId: 'tb-1', deviceState: 2 },
    { result: [
      { key: 'state', value: 2, lastUpdateTs: 400 },
      { key: 'err', value: 1, lastUpdateTs: 400 }
    ] },
    { result: {} }
  );
  assert.equal(status.printError, 1);
  assert.equal(status.printErrorDetail, '');
});

test('una impresora desconectada no muestra la última impresión ni su error', () => {
  const status = parsePrinterTelemetry(
    { name: 'Ender 3 V3 SE', telemetryId: 'tb-2', deviceState: 2, connectionState: 0, idleState: 0 },
    { result: [
      { key: 'state', value: 2, lastUpdateTs: 400 },
      { key: 'err', value: 1, lastUpdateTs: 400 },
      { key: 'printId', value: 'old-print', lastUpdateTs: 400 },
      { key: 'print', value: 'old.gcode', lastUpdateTs: 400 }
    ] },
    { result: {
      printProgress: [{ value: '100', ts: 400 }],
      printJobTime: [{ value: '1483', ts: 400 }]
    } },
    { printId: 'old-print', name: 'old.gcode', printError: 1, printErrorDetail: '' }
  );
  assert.equal(status.connected, false);
  assert.equal(status.state, null);
  assert.equal(status.stateLabel, 'Desconectada');
  assert.equal(status.active, false);
  assert.equal(status.gcodeName, '');
  assert.equal(status.printId, '');
  assert.equal(status.printError, 0);
  assert.equal(status.progress, 0);
  assert.equal(status.elapsedSeconds, 0);
});

test('una impresora conectada y en reposo no muestra la impresión finalizada anterior', () => {
  const status = parsePrinterTelemetry(
    { name: 'Ender 3', telemetryId: 'tb-1', deviceState: 2, connectionState: 1, idleState: 0 },
    { result: [
      { key: 'state', value: 2, lastUpdateTs: 400 },
      { key: 'err', value: 1, lastUpdateTs: 400 },
      { key: 'printId', value: 'old-print', lastUpdateTs: 400 },
      { key: 'print', value: 'old.gcode', lastUpdateTs: 400 }
    ] },
    { result: { printProgress: [{ value: '100', ts: 400 }] } },
    { printId: 'old-print', name: 'old.gcode', printError: 1, printErrorDetail: '' }
  );
  assert.equal(status.connected, true);
  assert.equal(status.state, 0);
  assert.equal(status.stateLabel, 'Inactiva');
  assert.equal(status.gcodeName, '');
  assert.equal(status.printError, 0);
  assert.equal(status.progress, 0);
});

test('el registro de la impresión actual prevalece sobre un error antiguo de telemetría', () => {
  const status = parsePrinterTelemetry(
    { name: 'Ender 3', telemetryId: 'tb-1', deviceState: 1, connectionState: 1, idleState: 0 },
    { result: [
      { key: 'state', value: 1, lastUpdateTs: 500 },
      { key: 'err', value: 1, lastUpdateTs: 400 },
      { key: 'errorMessage', value: 'Error de la impresión anterior', lastUpdateTs: 400 },
      { key: 'printId', value: 'current-print', lastUpdateTs: 500 }
    ] },
    { result: { printProgress: [{ value: '96', ts: 500 }] } },
    { printId: 'current-print', name: 'current.gcode', printError: 0, printErrorDetail: '' }
  );
  assert.equal(status.connected, true);
  assert.equal(status.stateLabel, 'Imprimiendo');
  assert.equal(status.gcodeName, 'current.gcode');
  assert.equal(status.printError, 0);
  assert.equal(status.printErrorDetail, '');
});
