import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCrealityProfile } from '../src/crealityProfile.js';

test('extrae el usuario y avatar del perfil de Creality Cloud', () => {
  const profile = parseCrealityProfile({
    result: {
      profileUserInfo: {
        base: {
          userId: 7963944884,
          nickName: 'Aguacatec',
          avatar: 'https://pic2-cdn.creality.com/avatar/example'
        }
      }
    }
  });

  assert.equal(profile.userId, '7963944884');
  assert.equal(profile.name, 'Aguacatec');
  assert.equal(profile.avatarUrl, 'https://pic2-cdn.creality.com/avatar/example');
  assert.ok(profile.updatedAt);
});

test('rechaza avatares externos o inseguros', () => {
  const external = parseCrealityProfile({
    result: { profileUserInfo: { base: { avatar: 'https://example.com/avatar.png' } } }
  });
  const insecure = parseCrealityProfile({
    result: { profileUserInfo: { base: { avatar: 'http://pic2-cdn.creality.com/avatar/example' } } }
  });

  assert.equal(external.avatarUrl, '');
  assert.equal(insecure.avatarUrl, '');
});
