import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPublicModelMetadata, extractPublicModelOwnership } from '../src/designMetadataRepair.js';

test('repara el nombre del autor desde JSON-LD conservando el perfil conocido', () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    '@type': 'Product',
    review: { author: { '@type': 'Person', name: 'Adamwl' } }
  })}</script>`;
  assert.deepEqual(extractPublicModelOwnership(
    html,
    'https://www.crealitycloud.com/es/model-detail/apple-core',
    { ownerUserId: '4753877997' }
  ), {
    author: 'Adamwl',
    authorUrl: 'https://www.crealitycloud.com/es/user/4753877997',
    ownerUserId: '4753877997'
  });
});

test('repara la categoría desde el título público de la ficha', () => {
  const html = '<html><head><title>Cajas ESP32 | Electrónica y RC (Radiocontrol) | Creality Cloud</title></head></html>';
  assert.deepEqual(extractPublicModelMetadata(
    html,
    'https://www.crealitycloud.com/es/model-detail/esp32-wroom32d-ld2410c-cases',
    { author: 'La_R3D', authorUrl: 'https://www.crealitycloud.com/es/user/8589082269' }
  ), {
    author: 'La_R3D',
    authorUrl: 'https://www.crealitycloud.com/es/user/8589082269',
    ownerUserId: '8589082269',
    category: 'Electrónica y RC (Radiocontrol)'
  });
});
