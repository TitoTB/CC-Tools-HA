import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCheckinRunMessage, raffleFailure, reconcileRafflePoints } from '../src/crealityTask.js';

test('conserva los premios y boletos pendientes cuando la lotería queda parcial', () => {
  assert.deepEqual(
    raffleFailure(4, 3, ['1GB Cloud Storage'], 'No se pudo cerrar el premio'),
    {
      success: false,
      status: 'partial',
      warning: true,
      reason: 'No se pudo cerrar el premio',
      tickets: 4,
      remainingTickets: 3,
      prizes: ['1GB Cloud Storage']
    }
  );
});

test('distingue un fallo total de lotería de un fallo del check-in', () => {
  assert.equal(raffleFailure(4, 4, [], 'Sorteo bloqueado').status, 'draw_failed');
});

test('un fallo parcial de lotería mantiene el check-in correcto e informa de los boletos pendientes', () => {
  const message = buildCheckinRunMessage(
    { status: 'completed_now', reward: '4 boletos de lotería' },
    raffleFailure(4, 3, ['1GB Cloud Storage'], 'No se pudo cerrar el premio')
  );

  assert.match(message, /^Check-in completado/);
  assert.match(message, /Lotería: 1GB Cloud Storage/);
  assert.match(message, /Lotería: 3 boletos pendientes/);
  assert.doesNotMatch(message, /Check-in fallido/);
});

test('corrige un resultado ambiguo de lotería cuando aumenta el saldo', () => {
  const raffle = reconcileRafflePoints(
    { status: 'completed', prizes: ['Sin premio'], tickets: 1 },
    { status: 'current', total: 8942 },
    { status: 'current', total: 9042 }
  );

  assert.deepEqual(raffle.prizes, ['100 puntos']);
  assert.equal(raffle.pointsDelta, 100);
  assert.equal(raffle.prizeConfirmedByPoints, true);
});

test('conserva Sin premio cuando el saldo no cambia', () => {
  const raffle = { status: 'completed', prizes: ['Sin premio'], tickets: 1 };
  assert.equal(
    reconcileRafflePoints(raffle, { total: 8942 }, { total: 8942 }),
    raffle
  );
});

test('no altera premios que ya fueron identificados en el diálogo', () => {
  const raffle = { status: 'completed', prizes: ['50 puntos'], tickets: 1 };
  assert.equal(
    reconcileRafflePoints(raffle, { total: 8942 }, { total: 8992 }),
    raffle
  );
});
