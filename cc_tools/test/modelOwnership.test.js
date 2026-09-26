import test from 'node:test';
import assert from 'node:assert/strict';
import {
  crealityUserIdFromUrl,
  findStructuredAuthorName,
  isOwnModel,
  normalizeModelOwnership,
  selectModelOwnership
} from '../src/modelOwnership.js';

test('extrae el identificador del autor desde perfiles localizados', () => {
  assert.equal(crealityUserIdFromUrl('https://www.crealitycloud.com/es/user/7963944884'), '7963944884');
  assert.equal(crealityUserIdFromUrl('https://www.crealitycloud.com/user/7963944884'), '7963944884');
});

test('identifica un diseño propio por el id o la URL del autor', () => {
  assert.equal(isOwnModel({ ownerUserId: '7963944884' }, '7963944884'), true);
  assert.equal(isOwnModel({ authorUrl: 'https://www.crealitycloud.com/es/user/7963944884' }, '7963944884'), true);
  assert.equal(isOwnModel({ ownerUserId: '123' }, '7963944884'), false);
});

test('solo acepta propietarios de Creality Cloud', () => {
  assert.deepEqual(
    normalizeModelOwnership('Usuario', '/es/user/7963944884', 'https://www.crealitycloud.com/es/model-detail/test'),
    {
      author: 'Usuario',
      authorUrl: 'https://www.crealitycloud.com/es/user/7963944884',
      ownerUserId: '7963944884'
    }
  );
  assert.deepEqual(normalizeModelOwnership('Usuario', 'https://example.com/user/7963944884'), {
    author: 'Usuario',
    authorUrl: '',
    ownerUserId: ''
  });
});

test('ignora el enlace vacío del avatar y usa el enlace con nombre del autor', () => {
  assert.deepEqual(selectModelOwnership([
    { name: '', href: '/es/user/4753877997', className: 'users' },
    { name: 'Adamwl', href: '/es/user/4753877997', className: 'users-name' }
  ], '', 'https://www.crealitycloud.com/es/model-detail/apple-core'), {
    author: 'Adamwl',
    authorUrl: 'https://www.crealitycloud.com/es/user/4753877997',
    ownerUserId: '4753877997'
  });
});

test('recupera el autor desde los metadatos estructurados de la ficha', () => {
  assert.equal(findStructuredAuthorName([JSON.stringify({
    '@type': 'Product',
    review: { '@type': 'Review', author: { '@type': 'Person', name: 'Adamwl' } }
  })]), 'Adamwl');
});
