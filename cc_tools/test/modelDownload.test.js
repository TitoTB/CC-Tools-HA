import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import { createServer } from 'http';
import os from 'os';
import path from 'path';
import {
  formatCatalogStats,
  hasPaidActionMarkup,
  hasCommercialModelLabel,
  hasPaidPrimaryActionText,
  normalizeCatalogCategories,
  normalizeModelAuthor,
  persistSignedDownload,
  persistSignedDownloads,
  selectModelCategory,
  selectModelCategoryFromTitle,
  selectPriorityDownloadCandidates
} from '../src/modelDownloadTask.js';

test('normaliza las categorías permitidas del catálogo sin duplicados', () => {
  assert.deepEqual(
    normalizeCatalogCategories(['Hogar', 'Arte y diseño', 'Hogar', 'Categoría inventada']),
    ['Hogar', 'Arte y diseño']
  );
  assert.deepEqual(normalizeCatalogCategories(undefined), []);
});

test('permite omitir por completo la prioridad de autores favoritos', () => {
  const indexed = [{
    id: 'favorite-model',
    indexedOnly: true,
    favoriteActive: true,
    ownerUserId: '200',
    url: 'https://www.crealitycloud.com/es/model-detail/favorite-model'
  }];

  assert.equal(selectPriorityDownloadCandidates(indexed, true, '100').length, 1);
  assert.deepEqual(selectPriorityDownloadCandidates(indexed, false, '100'), []);
});

test('extrae la categoría principal de los enlaces de una ficha', () => {
  assert.equal(selectModelCategory([
    { href: 'https://www.crealitycloud.com/es/model-category/3d-print-all', text: 'Todas las categorías' },
    { href: 'https://www.crealitycloud.com/es/model-category/art-design', text: 'Arte y diseño' },
    { href: 'https://www.crealitycloud.com/es/model-category/digital-art', text: 'Arte digital' }
  ]), 'Arte y diseño');
});

test('recupera la categoría desde el título cuando la ficha no expone enlaces', () => {
  assert.equal(
    selectModelCategoryFromTitle('Diademas para Halloween Archivo STL y 3MF para impresión 3D | Arte digital | Creality Cloud'),
    'Arte digital'
  );
  assert.equal(
    selectModelCategory([], 'Cajas ESP32 | Electrónica y RC (Radiocontrol) | Creality Cloud'),
    'Electrónica y RC (Radiocontrol)'
  );
});

test('normaliza el autor y su perfil de Creality Cloud', () => {
  assert.deepEqual(
    normalizeModelAuthor('poptico_3d', '/es/user/9798970463', 'https://www.crealitycloud.com/es/model-detail/example'),
    {
      author: 'poptico_3d',
      authorUrl: 'https://www.crealitycloud.com/es/user/9798970463'
    }
  );
});

test('no conserva enlaces de autor externos', () => {
  assert.deepEqual(normalizeModelAuthor('Autor', 'https://example.com/user/1'), {
    author: 'Autor',
    authorUrl: ''
  });
});

test('detecta la etiqueta española de un modelo comercial', () => {
  assert.equal(hasCommercialModelLabel('Descripción\nModelo comercial\nComprar'), true);
});

test('detecta la etiqueta inglesa de un modelo comercial', () => {
  assert.equal(hasCommercialModelLabel('Description\nCommercial model\nPurchase'), true);
});

test('no confunde una licencia que prohíbe uso comercial con un modelo comercial', () => {
  assert.equal(hasCommercialModelLabel('El modelo no puede utilizarse con fines comerciales.'), false);
});

test('detecta un botón principal de compra en español', () => {
  assert.equal(hasPaidPrimaryActionText('Comprar'), true);
  assert.equal(hasPaidPrimaryActionText('Comprar ahora'), true);
  assert.equal(hasPaidPrimaryActionText('Comprar por 300 puntos'), true);
  assert.equal(hasPaidPrimaryActionText('300 puntos'), true);
});

test('no confunde un botón de descarga con una compra', () => {
  assert.equal(hasPaidPrimaryActionText('Descargar 3MF'), false);
});

test('detecta una compra por puntos representada por iconos y precio', () => {
  assert.equal(hasPaidActionMarkup('operate-box iconfont icon-coin price', '300'), true);
  assert.equal(hasPaidActionMarkup('operate-box download-button', '300'), false);
});

test('el diagnóstico del catálogo muestra enlaces, conocidos y candidatos nuevos', () => {
  const result = formatCatalogStats([{
    label: 'Más reciente',
    sortApplied: true,
    rawLinks: 80,
    uniqueLinks: 20,
    knownLinks: 18,
    newCandidates: 2,
    scrollRounds: 5,
    stagnantRounds: 1
  }]);

  assert.match(result, /Enlaces visibles: 80/);
  assert.match(result, /Ya conocidos o excluidos: 18/);
  assert.match(result, /Candidatos nuevos: 2/);
});

test('guarda un enlace firmado sin depender del contexto de Chromium', async () => {
  const content = Buffer.from('contenido 3mf de prueba');
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-disposition': 'attachment; filename="modelo-prueba.3mf"',
      'content-length': String(content.length)
    });
    response.end(content);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cctools-download-'));

  try {
    const address = server.address();
    const result = await persistSignedDownload(
      `http://127.0.0.1:${address.port}/modelo.3mf`,
      directory,
      'Modelo de prueba'
    );
    assert.equal(result.name, 'modelo-prueba.3mf');
    assert.equal(result.size, content.length);
    assert.deepEqual(await fs.readFile(path.join(directory, result.name)), content);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('reconstruye un ZIP con varios STL sin depender del contexto de Chromium', async () => {
  const files = new Map([
    ['/pieza-a.stl', Buffer.from('pieza A')],
    ['/pieza-b.stl', Buffer.from('pieza B')]
  ]);
  const server = createServer((request, response) => {
    const content = files.get(request.url);
    response.writeHead(content ? 200 : 404, {
      'content-type': 'application/octet-stream',
      'content-disposition': `attachment; filename="${path.basename(request.url)}"`,
      'content-length': String(content?.length || 0)
    });
    response.end(content || '');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cctools-download-set-'));

  try {
    const { port } = server.address();
    const result = await persistSignedDownloads([
      { fileName: 'pieza A', url: `http://127.0.0.1:${port}/pieza-a.stl` },
      { fileName: 'pieza B', url: `http://127.0.0.1:${port}/pieza-b.stl` }
    ], directory, 'Modelo multipartes');
    const archive = await fs.readFile(path.join(directory, result.name));
    assert.equal(result.name, 'modelo-multipartes.zip');
    assert.ok(result.size > files.get('/pieza-a.stl').length + files.get('/pieza-b.stl').length);
    assert.match(archive.toString('latin1'), /pieza A\.stl/);
    assert.match(archive.toString('latin1'), /pieza B\.stl/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
