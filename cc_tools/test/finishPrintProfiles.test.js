import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activateNextFinishPrintProfile,
  finishPrintProfileForPending,
  normalizeFinishPrintProfiles,
  syncActiveFinishPrintProfile,
  totalFinishPrintDailyLimit
} from '../src/finishPrintProfiles.js';

test('migrates the legacy printer configuration into the first profile', () => {
  const profiles = normalizeFinishPrintProfiles({
    printerName: 'Ender 3',
    windowStart: '09:00',
    windowEnd: '18:00',
    dailyLimit: 3,
    cloudFiles: ['pieza.gcode'],
    cloudFileRecords: [{ id: 'gcode-1', name: 'pieza.gcode', printTime: 600 }]
  });

  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].id, 'printer-1');
  assert.equal(profiles[0].printerName, 'Ender 3');
  assert.equal(profiles[0].dailyLimit, 3);
  assert.equal(profiles[0].printMode, 'random');
  assert.deepEqual(profiles[0].cloudFiles, ['pieza.gcode']);
});

test('asocia una impresión manual con la programación de su impresora', () => {
  const task = {
    activePrinterProfileId: 'one',
    printerProfiles: [
      { id: 'one', printerName: 'Ender 3' },
      { id: 'two', printerName: 'K1' }
    ]
  };

  const profile = finishPrintProfileForPending(task, {
    manualSelection: true,
    printerName: 'K1'
  });

  assert.equal(profile.id, 'two');
});

test('normalizes the print mode and per-file quantities', () => {
  const [profile] = normalizeFinishPrintProfiles({
    printerProfiles: [{
      id: 'one',
      printerName: 'Ender 3',
      printMode: 'quantities',
      cloudFiles: ['a.gcode'],
      cloudFileRecords: [{ id: 'a', name: 'a.gcode', quantity: 4 }]
    }]
  });
  assert.equal(profile.printMode, 'quantities');
  assert.equal(profile.cloudFileRecords[0].quantity, 4);
});

test('an explicit configuration without printers stays empty', () => {
  assert.deepEqual(normalizeFinishPrintProfiles({ printerProfiles: [], printerName: '' }), []);
  assert.equal(totalFinishPrintDailyLimit({ printerProfiles: [], printerName: '' }), 0);
});

test('activates the printer with the earliest pending execution', () => {
  const task = {
    printerProfiles: [
      { id: 'late', printerName: 'Ender 3', dailyLimit: 2, nextRunAt: '2026-09-25T12:00:00.000Z' },
      { id: 'early', printerName: 'K1', dailyLimit: 4, nextRunAt: '2026-09-25T10:00:00.000Z' }
    ]
  };

  activateNextFinishPrintProfile(task, { sync: false });
  assert.equal(task.activePrinterProfileId, 'early');
  assert.equal(task.printerName, 'K1');
  assert.equal(task.nextRunAt, '2026-09-25T10:00:00.000Z');
  assert.equal(totalFinishPrintDailyLimit(task), 6);
});

test('keeps shuffle and schedule state inside the active printer profile', () => {
  const task = {
    activePrinterProfileId: 'one',
    printerName: 'Ender 3',
    cloudFiles: ['actual.gcode'],
    shuffleBag: ['actual.gcode'],
    shuffleBagCursor: 1,
    printPlan: ['2026-09-25T10:00:00.000Z'],
    printPlanCursor: 1,
    nextRunAt: '',
    printerProfiles: [{ id: 'one', printerName: 'Ender 3', cloudFiles: ['anterior.gcode'] }]
  };

  syncActiveFinishPrintProfile(task);
  assert.deepEqual(task.printerProfiles[0].cloudFiles, ['actual.gcode']);
  assert.equal(task.printerProfiles[0].shuffleBagCursor, 1);
  assert.equal(task.printerProfiles[0].printPlanCursor, 1);
});
