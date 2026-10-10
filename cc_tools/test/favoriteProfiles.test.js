import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FAVORITE_PROFILE,
  normalizeFavoriteProfiles,
  parseFavoriteProfileUrl
} from '../src/favoriteProfiles.js';

test('parseFavoriteProfileUrl accepts Creality Cloud profile URLs and canonicalizes them', () => {
  assert.deepEqual(parseFavoriteProfileUrl('https://www.crealitycloud.com/es/user/123456789/model'), {
    userId: '123456789',
    profileUrl: 'https://www.crealitycloud.com/es/user/123456789'
  });
  assert.deepEqual(parseFavoriteProfileUrl('https://crealitycloud.com/user/987654321'), {
    userId: '987654321',
    profileUrl: 'https://www.crealitycloud.com/es/user/987654321'
  });
});

test('parseFavoriteProfileUrl rejects unrelated and malformed URLs', () => {
  assert.equal(parseFavoriteProfileUrl('https://example.com/es/user/123'), null);
  assert.equal(parseFavoriteProfileUrl('https://www.crealitycloud.com/es/model-detail/example'), null);
  assert.equal(parseFavoriteProfileUrl('not a url'), null);
});

test('normalizeFavoriteProfiles always includes Aguacatec first and removes duplicates', () => {
  const profiles = normalizeFavoriteProfiles([
    { ...DEFAULT_FAVORITE_PROFILE, name: 'Alterado' },
    {
      userId: '123456789',
      name: 'Maker',
      avatarUrl: 'https://pic2-cdn.creality.com/avatar/maker',
      profileUrl: 'https://www.crealitycloud.com/en/user/123456789/model'
    },
    {
      userId: '123456789',
      name: 'Duplicado',
      profileUrl: 'https://www.crealitycloud.com/es/user/123456789'
    }
  ]);

  assert.equal(profiles.length, 2);
  assert.deepEqual(profiles[0], DEFAULT_FAVORITE_PROFILE);
  assert.deepEqual(profiles[1], {
    userId: '123456789',
    name: 'Maker',
    avatarUrl: 'https://pic2-cdn.creality.com/avatar/maker',
    profileUrl: 'https://www.crealitycloud.com/es/user/123456789',
    isDefault: false,
    indexStatus: 'pending',
    indexedAt: '',
    fullIndexedAt: '',
    lastModelIndexedAt: '',
    indexedModelCount: 0
  });
});

test('an empty favorite index is never presented as ready', () => {
  const profiles = normalizeFavoriteProfiles([{
    userId: '123456789',
    name: 'Maker',
    profileUrl: 'https://www.crealitycloud.com/es/user/123456789',
    indexStatus: 'ready',
    indexedAt: '2026-09-25T08:00:00.000Z',
    fullIndexedAt: '2026-09-25T08:00:00.000Z',
    indexedModelCount: 0
  }]);

  assert.equal(profiles[1].indexStatus, 'pending');
  assert.equal(profiles[1].indexedModelCount, 0);
});


test('conserva Sin diseños confirmado en favoritos normales y predeterminados al reiniciar', () => {
  const state = { indexStatus: 'empty', indexedModelCount: 0,
    indexedAt: '2026-10-10T10:00:00.000Z', fullIndexedAt: '2026-10-10T10:00:00.000Z' };
  const profiles = normalizeFavoriteProfiles([
    { ...DEFAULT_FAVORITE_PROFILE, ...state },
    { userId: '123456789', name: 'Vacío', ...state }
  ]);
  assert.equal(profiles.length, 2);
  for (const profile of profiles) {
    assert.equal(profile.indexStatus, 'empty');
    assert.equal(profile.indexedAt, state.indexedAt);
    assert.equal(profile.fullIndexedAt, state.fullIndexedAt);
  }
  assert.deepEqual(normalizeFavoriteProfiles(profiles), profiles);
});
