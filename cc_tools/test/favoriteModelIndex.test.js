import test from 'node:test';
import assert from 'node:assert/strict';
import { selectFavoriteCandidates, shouldSyncConfiguredFavorites } from '../src/favoriteModelIndex.js';

test('pospone la indexación inicial hasta completar el asistente', () => {
  assert.equal(shouldSyncConfiguredFavorites({ setup: { assistantCompleted: false } }), false);
  assert.equal(shouldSyncConfiguredFavorites({}), false);
  assert.equal(shouldSyncConfiguredFavorites({ setup: { assistantCompleted: true } }), true);
});

test('alterna candidatos entre perfiles favoritos para repartir las tareas', () => {
  const candidates = selectFavoriteCandidates([
    design('a1', 'a', '2026-09-25T10:00:00Z'),
    design('a2', 'a', '2026-09-25T09:00:00Z'),
    design('b1', 'b', '2026-09-25T08:00:00Z'),
    design('b2', 'b', '2026-09-25T07:00:00Z')
  ]);

  assert.deepEqual(candidates.map((item) => item.id), ['a1', 'b1', 'a2', 'b2']);
});

test('omite perfiles retirados, modelos no disponibles y diseños propios', () => {
  const candidates = selectFavoriteCandidates([
    design('active', 'a'),
    { ...design('removed', 'b'), favoriteActive: false },
    { ...design('missing', 'c'), favoriteAvailability: 'unavailable' },
    { ...design('own', '42'), ownerUserId: '42' }
  ], '', '42');

  assert.deepEqual(candidates.map((item) => item.id), ['active']);
});

test('prioriza el perfil con menos tareas completadas', () => {
  const candidates = selectFavoriteCandidates([
    { ...design('a-done', 'a'), likeCompleted: true },
    { ...design('a-pending', 'a'), likeCompleted: false },
    { ...design('b-pending', 'b'), likeCompleted: false }
  ], 'likeCompleted');

  assert.deepEqual(candidates.map((item) => item.id), ['b-pending', 'a-pending']);
});

function design(id, profileId, discoveredAt = '2026-09-25T00:00:00Z') {
  return {
    id,
    url: `https://www.crealitycloud.com/es/model-detail/${id}`,
    favoriteActive: true,
    favoriteAvailability: 'active',
    favoriteProfileId: profileId,
    ownerUserId: profileId,
    discoveredAt
  };
}
