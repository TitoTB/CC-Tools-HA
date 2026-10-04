import test from 'node:test';
import assert from 'node:assert/strict';
import {
  localDateKey,
  mergePointTransactions,
  mergePointsState,
  parsePointsSummary,
  parsePointsTotal,
  pointsSummaryFromResult,
  readPointsSummary
} from '../src/pointsCounter.js';

test('parsea el saldo y suma los movimientos positivos del día', () => {
  const now = new Date('2026-09-22T10:00:00.000Z');
  const text = `
    Puntos totales Ver reglas » 8,942 Puntos estándar 8,942
    Download Models 2026-09-22 09:03:21 + 1
    Like 3D Model 2026-09-22 09:05:10 + 1
    Gift 2026-09-22 09:10:00 - 50
    Check-in 2026-09-21 08:00:00 + 5
  `;
  const result = parsePointsSummary(text, { timezone: 'Europe/Madrid', now });

  assert.equal(result.total, 8942);
  assert.equal(result.earnedToday, 2);
  assert.equal(result.transactionCount, 2);
  assert.deepEqual(result.transactions.slice(0, 2), [
    { date: '2026-09-22', time: '09:03:21', amount: 1, type: 'Descargas realizadas', sourceType: 'Download Models' },
    { date: '2026-09-22', time: '09:05:10', amount: 1, type: 'Dar me gusta', sourceType: 'Like 3D Model' }
  ]);
  assert.equal(result.status, 'current');
});

test('admite las etiquetas de puntos en inglés', () => {
  assert.equal(parsePointsTotal('Total Points View Rules 12,345 Standard Points 12,345'), 12345);
});

test('agrupa descargas e impulsos del historial por sus descripciones de modelo', () => {
  const result = parsePointsSummary(`
    Your (Crowpanel Epaper holder) model has reached 10 usage 2026-09-24 08:00:00 + 100
    Your (R2D2) model has received the support of La_R3D 2026-09-24 08:01:00 + 100
  `, { timezone: 'Europe/Madrid', now: new Date('2026-09-24T10:00:00Z') });

  assert.deepEqual(result.transactions.map((transaction) => transaction.type), ['Descargas recibidas', 'Impulsos recibidos']);
});

test('distingue descargas e impulsos realizados de los recibidos', () => {
  const parsed = parsePointsSummary(`
    Download Models 2026-09-24 08:00:00 + 1
    Your (Crowpanel Epaper holder) model has reached 10 usage 2026-09-24 08:01:00 + 100
    Model Boost 2026-09-24 08:02:00 + 1
    Your (R2D2) model has received the support of La_R3D 2026-09-24 08:03:00 + 100
  `, { timezone: 'Europe/Madrid', now: new Date('2026-09-24T10:00:00Z') });
  const cached = [{
    ...parsed.transactions[1],
    type: 'Descargas'
  }];

  assert.deepEqual(parsed.transactions.map((transaction) => transaction.type), [
    'Descargas realizadas',
    'Descargas recibidas',
    'Impulsos dados',
    'Impulsos recibidos'
  ]);
  assert.equal(mergePointTransactions(cached, [])[0].type, 'Descargas recibidas');
});

test('migra por importe las descargas e impulsos antiguos sin origen', () => {
  const transactions = mergePointTransactions([
    { date: '2026-09-20', time: '08:00:00', amount: 1, type: 'Descarga de diseños' },
    { date: '2026-09-20', time: '08:01:00', amount: 100, type: 'Descarga de diseños' },
    { date: '2026-09-20', time: '08:02:00', amount: 1, type: 'Impulsar diseños' },
    { date: '2026-09-20', time: '08:03:00', amount: 100, type: 'Impulsar diseños' }
  ], []);

  assert.deepEqual(transactions.map((transaction) => transaction.type), [
    'Descargas realizadas',
    'Descargas recibidas',
    'Impulsos dados',
    'Impulsos recibidos'
  ]);
});

test('lee movimientos aunque la web los entregue con saltos de línea y fecha localizada', () => {
  const result = parsePointsSummary(`
    Comentario sobre un modelo
    24/09/2026, 08:15
    +1
    Enviar una impresión
    2026-09-24 09:20:00
    +5
  `, { timezone: 'Europe/Madrid', now: new Date('2026-09-24T10:00:00Z') });

  assert.equal(result.earnedToday, 6);
  assert.equal(result.transactionCount, 2);
  assert.deepEqual(result.transactions.map((transaction) => transaction.date), ['2026-09-24', '2026-09-24']);
});

test('normaliza Lucky Draw como Lotería', () => {
  const result = parsePointsSummary(
    'Lucky Draw 2026-09-24 10:00:00 + 100',
    { timezone: 'Europe/Madrid', now: new Date('2026-09-24T10:00:00Z') }
  );

  assert.equal(result.transactions[0].type, 'Lotería');
});

test('traduce las tareas generales del historial de puntos', () => {
  const result = parsePointsSummary(`
    Convert 2026-09-24 10:00:00 + 1
    Add a Device 2026-09-24 10:01:00 + 5
    Edit profile 2026-09-24 10:02:00 + 10
    Upload Models 2026-09-24 10:03:00 + 20
  `, { timezone: 'Europe/Madrid', now: new Date('2026-09-24T10:00:00Z') });

  assert.deepEqual(result.transactions.map((transaction) => transaction.type), [
    'Conversión',
    'Añadir dispositivo',
    'Completar perfil',
    'Subida de diseños'
  ]);
});

test('separa una conversión del encabezado y los filtros de la página', () => {
  const header = '9,075 Puntos estándar Tienda de regalos 0 Puntos Spotlight Convertir Tareas Puntos All Tipo 1 mes Todo Ingresos: 5,838 Gastos: 3,723';
  const result = parsePointsSummary(`
    ${header} Convert 2026-09-28 09:30:00 + 132
  `, { timezone: 'Europe/Madrid', now: new Date('2026-09-28T10:00:00Z') });

  assert.deepEqual(result.transactions, [{
    date: '2026-09-28',
    time: '09:30:00',
    amount: 132,
    type: 'Conversión',
    sourceType: 'Convert'
  }]);
});

test('repara una conversión guardada con el encabezado completo como nombre', () => {
  const sourceType = '9,075 Puntos estándar Tienda de regalos 0 Puntos Spotlight Convertir Tareas Puntos All Tipo 1 mes Todo Ingresos: 5,838 Gastos: 3,723 Convert';
  const transactions = mergePointTransactions([{
    date: '2026-09-28',
    time: '09:30:00',
    amount: 132,
    type: sourceType,
    sourceType
  }], []);

  assert.deepEqual(transactions, [{
    date: '2026-09-28',
    time: '09:30:00',
    amount: 132,
    type: 'Conversión',
    sourceType: 'Convert'
  }]);
});

test('conserva dos tipos de check-in con la misma hora e importe', () => {
  const parsed = parsePointsSummary(`
    Consecutive Check-in 2026-09-25 07:36:09 + 40
    Member Double Check-in 2026-09-25 07:36:09 + 40
  `, { timezone: 'Europe/Madrid', now: new Date('2026-09-25T10:00:00Z') });
  const transactions = mergePointTransactions([], parsed.transactions);

  assert.equal(transactions.length, 2);
  assert.equal(transactions.reduce((total, transaction) => total + transaction.amount, 0), 80);
  assert.deepEqual(transactions.map((transaction) => transaction.type), ['Check-in diario', 'Check-in diario']);
});

test('sustituye el movimiento legado colapsado al recargar los tipos originales', () => {
  const legacy = [
    {
      date: '2026-09-25',
      time: '07:36:09',
      amount: 40,
      type: 'Check-in diario'
    },
    {
      date: '2026-09-25',
      time: '07:36:09',
      amount: 40,
      type: 'Descarga de diseños'
    }
  ];
  const refreshed = parsePointsSummary(`
    Consecutive Check-in 2026-09-25 07:36:09 + 40
    Member Double Check-in 2026-09-25 07:36:09 + 40
  `, { timezone: 'Europe/Madrid', now: new Date('2026-09-25T10:00:00Z') });
  const migrated = mergePointTransactions(legacy, []);
  const transactions = mergePointTransactions(legacy, refreshed.transactions);

  assert.equal(migrated.length, 2);
  assert.deepEqual(migrated.map((transaction) => transaction.type), ['Check-in diario', 'Check-in diario']);
  assert.deepEqual(migrated.map((transaction) => transaction.sourceType), [
    'Consecutive Check-in',
    'Member Double Check-in'
  ]);
  assert.equal(transactions.length, 2);
  assert.equal(transactions.reduce((total, transaction) => total + transaction.amount, 0), 80);
  assert.deepEqual(transactions.map((transaction) => transaction.type), ['Check-in diario', 'Check-in diario']);
});

test('calcula el acumulado diario desde el saldo del día anterior', () => {
  const current = {
    total: 8942,
    earnedToday: 0,
    date: '2026-09-21',
    status: 'current'
  };
  const merged = mergePointsState(current, {
    total: 8950,
    earnedToday: 3,
    transactionCount: 3,
    date: '2026-09-22',
    updatedAt: '2026-09-22T12:00:00.000Z',
    status: 'current'
  });

  assert.equal(merged.total, 8950);
  assert.equal(merged.previousDayTotal, 8942);
  assert.equal(merged.earnedToday, 8);
  assert.equal(merged.status, 'current');
});

test('conserva la referencia del día anterior ante lecturas sucesivas', () => {
  const current = {
    total: 8950,
    previousDayTotal: 8942,
    earnedToday: 8,
    date: '2026-09-22',
    status: 'current'
  };
  const merged = mergePointsState(current, {
    total: 8954,
    earnedToday: 1,
    transactionCount: 1,
    date: '2026-09-22',
    updatedAt: '2026-09-22T14:00:00.000Z',
    status: 'current'
  });

  assert.equal(merged.previousDayTotal, 8942);
  assert.equal(merged.earnedToday, 12);
});

test('el acumulado diario siempre es la resta respecto al cierre anterior', () => {
  const merged = mergePointsState({
    total: 8950,
    previousDayTotal: 8942,
    earnedToday: 3,
    date: '2026-09-22',
    status: 'current'
  }, {
    total: 8955,
    earnedToday: 3,
    transactionCount: 3,
    date: '2026-09-22',
    updatedAt: '2026-09-22T15:00:00.000Z',
    status: 'current'
  });

  assert.equal(merged.previousDayTotal, 8942);
  assert.equal(merged.earnedToday, 13);
});

test('migra el estado anterior deduciendo el saldo base del día', () => {
  const merged = mergePointsState({
    total: 8950,
    earnedToday: 8,
    date: '2026-09-22',
    status: 'current'
  }, {
    total: 8952,
    earnedToday: 2,
    date: '2026-09-22',
    updatedAt: '2026-09-22T15:00:00.000Z',
    status: 'current'
  });

  assert.equal(merged.previousDayTotal, 8942);
  assert.equal(merged.earnedToday, 10);
});

test('repara una referencia diaria guardada con el saldo actual', () => {
  const merged = mergePointsState({
    total: 8950,
    previousDayTotal: 8950,
    earnedToday: 0,
    date: '2026-09-22',
    status: 'current'
  }, {
    total: 8955,
    earnedToday: 5,
    date: '2026-09-22',
    updatedAt: '2026-09-22T15:00:00.000Z',
    status: 'current'
  });

  assert.equal(merged.previousDayTotal, 8950);
  assert.equal(merged.earnedToday, 5);
});

test('no crea un cierre diario falso cuando no se leen movimientos', () => {
  const merged = mergePointsState({}, {
    total: 8955,
    earnedToday: 0,
    date: '2026-09-22',
    updatedAt: '2026-09-22T15:00:00.000Z',
    status: 'current'
  });

  assert.equal(merged.previousDayTotal, null);
  assert.equal(merged.earnedToday, 0);
});

test('marca el histórico como completo tras la primera carga y lo conserva en deltas', () => {
  const first = mergePointsState({}, {
    total: 8955,
    earnedToday: 5,
    date: '2026-09-22',
    historyComplete: true,
    updatedAt: '2026-09-22T15:00:00.000Z',
    status: 'current'
  });
  const delta = mergePointsState(first, {
    total: 8956,
    earnedToday: 1,
    date: '2026-09-22',
    updatedAt: '2026-09-22T16:00:00.000Z',
    status: 'current'
  });

  assert.equal(first.historyComplete, true);
  assert.equal(delta.historyComplete, true);
});

test('la carga completa sustituye movimientos antiguos colapsados', () => {
  const current = {
    total: 9000,
    date: '2026-09-25',
    status: 'current',
    historyComplete: true,
    transactions: [
      { date: '2026-09-25', time: '07:36:09', amount: 40, type: 'Check-in diario' },
      { date: '2026-09-24', time: '11:00:00', amount: 40, type: 'Descarga de diseños' }
    ]
  };
  const snapshot = {
    total: 9000,
    earnedToday: 80,
    transactionCount: 2,
    date: '2026-09-25',
    updatedAt: '2026-09-25T08:00:00.000Z',
    status: 'current',
    historyComplete: true,
    transactions: [
      {
        date: '2026-09-25',
        time: '07:36:09',
        amount: 40,
        type: 'Check-in diario',
        sourceType: 'Consecutive Check-in'
      },
      {
        date: '2026-09-25',
        time: '07:36:09',
        amount: 40,
        type: 'Check-in diario',
        sourceType: 'Member Double Check-in'
      }
    ]
  };

  const merged = mergePointsState(current, snapshot, { replaceTransactions: true });

  assert.equal(merged.transactions.length, 2);
  assert.equal(merged.transactions.reduce((total, transaction) => total + transaction.amount, 0), 80);
  assert.deepEqual(merged.transactions.map((transaction) => transaction.sourceType), [
    'Consecutive Check-in',
    'Member Double Check-in'
  ]);
  assert.equal(merged.transactions.some((transaction) => transaction.type === 'Descarga de diseños'), false);
});

test('la carga completa espera a que el contenedor permanezca estable al final', async () => {
  let scrollReads = 0;
  const page = {
    goto: async () => {},
    waitForTimeout: async () => {},
    locator: () => ({
      innerText: async () => 'Total Points 100 Download Models 2026-09-24 10:00:00 + 1'
    }),
    evaluate: async () => {
      scrollReads += 1;
      const height = scrollReads < 4 ? scrollReads * 100 : 400;
      return {
        height: 900,
        top: 500,
        containers: `${height}:100:${height - 100}`,
        atBottom: true
      };
    }
  };

  const result = await readPointsSummary(page, { fullHistory: true });

  assert.equal(result.historyComplete, true);
  assert.equal(scrollReads, 12);
});

test('el histórico conserva más de dos mil movimientos', () => {
  const transactions = Array.from({ length: 2101 }, (_, index) => ({
    date: '2026-09-24',
    time: `${String(Math.floor(index / 60) % 24).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}:${String(index).padStart(4, '0')}`,
    amount: 1,
    type: `Tarea ${index}`
  }));
  const merged = mergePointsState({}, {
    total: 2101,
    earnedToday: 2101,
    date: '2026-09-24',
    transactions,
    updatedAt: '2026-09-24T15:00:00.000Z',
    status: 'current'
  });

  assert.equal(merged.transactions.length, 2101);
});

test('una lectura fallida conserva el último saldo como obsoleto', () => {
  const current = { total: 8942, earnedToday: 8, date: '2026-09-22', status: 'current' };
  const merged = mergePointsState(current, {
    status: 'unavailable',
    updatedAt: '2026-09-22T12:00:00.000Z',
    error: 'timeout'
  });

  assert.equal(merged.total, 8942);
  assert.equal(merged.earnedToday, 8);
  assert.equal(merged.status, 'stale');
  assert.equal(merged.error, 'timeout');
});

test('calcula la fecha local en la zona configurada', () => {
  assert.equal(localDateKey(new Date('2026-09-21T23:30:00.000Z'), 'Europe/Madrid'), '2026-09-22');
});

test('encuentra el saldo dentro de una descarga acreditada', () => {
  const pointsSummary = {
    status: 'current',
    total: 8950,
    earnedToday: 9,
    date: '2026-09-22'
  };
  const result = {
    details: {
      downloaded: [{
        title: 'Modelo',
        rewardVerification: { after: { pointsSummary } }
      }]
    }
  };

  assert.equal(pointsSummaryFromResult(result), pointsSummary);
});
