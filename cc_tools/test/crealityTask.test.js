import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileRafflePoints } from '../src/crealityTask.js';

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
