import test from 'node:test';
import assert from 'node:assert/strict';
import { boostConsumedToday, boostResponseAccepted, selectBoostCandidates, verifyBoostLottery } from '../src/modelBoostTask.js';

test('selecciona solo diseños favoritos activos en rondas del menos impulsado al más impulsado', () => {
  const candidates = selectBoostCandidates([
    { id: 'regular', source: 'random', url: 'https://example.com/regular', downloadedAt: '2026-09-01T00:00:00Z', boostCount: 0 },
    { id: 'new', favoriteActive: true, url: 'https://example.com/new', downloadedAt: '2026-09-03T00:00:00Z', boostCount: 0 },
    { id: 'used', favoriteActive: true, url: 'https://example.com/used', downloadedAt: '2026-09-01T00:00:00Z', boostCount: 1 },
    { id: 'old', favoriteActive: true, url: 'https://example.com/old', downloadedAt: '2026-09-02T00:00:00Z', boostCount: 0 },
    { id: 'removed', favoriteActive: false, url: 'https://example.com/removed', boostCount: 0 }
  ]);

  assert.deepEqual(candidates.map((design) => design.id), ['old', 'new', 'used']);
});

test('excluye los diseños propios de los candidatos para boost', () => {
  const candidates = selectBoostCandidates([
    { id: 'own', favoriteActive: true, url: 'https://example.test/own', ownerUserId: '42' },
    { id: 'external', favoriteActive: true, url: 'https://example.test/external', ownerUserId: '84' }
  ], '42');

  assert.deepEqual(candidates.map((design) => design.id), ['external']);
});

test('incluye otros diseños descargados cuando se desactiva el modo solo favoritos', () => {
  const candidates = selectBoostCandidates([
    { id: 'favorite', favoriteActive: true, indexedOnly: true, url: 'https://example.test/favorite' },
    { id: 'downloaded', indexedOnly: false, url: 'https://example.test/downloaded' },
    { id: 'indexed', indexedOnly: true, url: 'https://example.test/indexed' }
  ], '', false);

  assert.deepEqual(candidates.map((design) => design.id), ['favorite', 'downloaded']);
});

test('considera utilizado el boost aunque falle la verificación posterior', () => {
  const runs = [{
    taskId: 'modelBoosts',
    status: 'failed',
    finishedAt: '2026-09-23T08:30:00.000Z',
    details: { boostConsumed: true }
  }];

  assert.equal(boostConsumedToday(runs, 'Europe/Madrid', new Date('2026-09-23T12:00:00.000Z')), true);
  assert.equal(boostConsumedToday(runs, 'Europe/Madrid', new Date('2026-09-24T12:00:00.000Z')), false);
});

test('verifica el boost por la lotería y no por el saldo de puntos', () => {
  assert.deepEqual(verifyBoostLottery({ status: 'completed', prizes: ['Sin premio'] }), {
    status: 'lottery_completed',
    source: 'raffle',
    raffleStatus: 'completed',
    prizes: ['Sin premio']
  });
  assert.equal(verifyBoostLottery({ status: 'counter_unavailable' }).status, 'lottery_unverified');
});

test('distingue diseños que Creality permite impulsar', () => {
  assert.equal(boostResponseAccepted({ ok: true, body: { code: 0, result: { failType: 0 } } }), true);
  assert.equal(boostResponseAccepted({ ok: true, body: { code: 0, result: { failType: 1 } } }), false);
  assert.equal(boostResponseAccepted({ ok: false, body: { code: 500 } }), false);
});
