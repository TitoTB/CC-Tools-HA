import test from 'node:test';
import assert from 'node:assert/strict';
import {
  estimatedFinishPrintDurationMinutes,
  finishPrintSlotMinutes,
  requiredFinishPrintWindowMinutes
} from '../src/finishPrintSchedule.js';

test('usa la duración más larga de los G-code seleccionados', () => {
  const task = {
    cloudFileRecords: [
      { name: 'corto.gcode', printTime: 601 },
      { name: 'largo.gcode', printTime: 1800 }
    ]
  };

  assert.equal(estimatedFinishPrintDurationMinutes(task), 30);
});

test('reserva diez minutos cuando Creality no informa la duración', () => {
  assert.equal(estimatedFinishPrintDurationMinutes({ cloudFileRecords: [] }), 10);
});

test('la ventana incluye duración, intervalo y margen por cada impresión', () => {
  const task = {
    dailyLimit: 3,
    minIntervalMinutes: 20,
    cloudFileRecords: [{ name: 'modelo.gcode', printTime: 1800 }]
  };

  assert.equal(finishPrintSlotMinutes(task), 55);
  assert.equal(requiredFinishPrintWindowMinutes(task), 165);
});
