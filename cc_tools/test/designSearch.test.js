import test from 'node:test';
import assert from 'node:assert/strict';
import { filterDesigns, normalizeDesignSort, sortDesigns, sortDesignsByActivity } from '../src/designSearch.js';

const designs = [
  { title: 'Dragón articulado', url: 'https://example.com/model-detail/dragon' },
  { title: 'Soporte de pared', url: 'https://example.com/model-detail/wall-holder' },
  { title: 'Caja sencilla', url: 'https://example.com/model-detail/simple-box' }
];

test('busca diseños sin distinguir mayúsculas ni acentos', () => {
  assert.deepEqual(filterDesigns(designs, 'DRAGON'), [designs[0]]);
});

test('busca en todo el inventario por nombre o URL', () => {
  assert.deepEqual(filterDesigns(designs, 'holder'), [designs[1]]);
  assert.deepEqual(filterDesigns(designs, 'caja'), [designs[2]]);
});

test('una búsqueda vacía conserva todos los diseños', () => {
  assert.equal(filterDesigns(designs, '').length, designs.length);
});

test('filtra por el estado completado de cada tarea', () => {
  const records = [
    { title: 'Completo', likeCompleted: true, collectionCompleted: true, commentCompleted: true },
    { title: 'Pendiente', likeCompleted: false, collectionCompleted: false, commentCompleted: false }
  ];
  assert.deepEqual(filterDesigns(records, '', { like: 'yes' }), [records[0]]);
  assert.deepEqual(filterDesigns(records, '', { collection: 'no' }), [records[1]]);
  assert.deepEqual(filterDesigns(records, '', { comment: 'yes' }), [records[0]]);
});

test('filtra por un rango inclusivo de fechas en la zona configurada', () => {
  const records = [
    { title: 'Dentro', updatedAt: '2026-09-23T21:30:00Z' },
    { title: 'Fuera', updatedAt: '2026-09-22T20:00:00Z' }
  ];
  assert.deepEqual(filterDesigns(records, '', {
    from: '2026-09-23',
    to: '2026-09-23',
    timezone: 'Europe/Madrid'
  }), [records[0]]);
});

test('filtra diseños por el identificador de un autor favorito', () => {
  const records = [
    { title: 'Aguacatec', ownerUserId: '7963944884' },
    { title: 'La_R3D', favoriteProfileId: '8589082269' },
    { title: 'Otro autor', ownerUserId: '100' }
  ];

  assert.deepEqual(filterDesigns(records, '', { favoriteAuthor: '8589082269' }), [records[1]]);
  assert.equal(filterDesigns(records, '', { favoriteAuthor: 'all' }).length, 3);
});

test('ordena los diseños por su última actividad', () => {
  const ordered = sortDesignsByActivity([
    { title: 'Antiguo', downloadedAt: '2026-09-20T10:00:00Z', updatedAt: '2026-09-20T10:00:00Z' },
    { title: 'Actualizado', downloadedAt: '2026-09-19T10:00:00Z', updatedAt: '2026-09-23T10:00:00Z' },
    { title: 'Reciente', downloadedAt: '2026-09-22T10:00:00Z' }
  ]);

  assert.deepEqual(ordered.map((design) => design.title), ['Actualizado', 'Reciente', 'Antiguo']);
});

test('ordena todas las columnas en sentido ascendente y descendente', () => {
  const records = [
    { title: 'Zeta', author: 'Ana', updatedAt: '2026-09-20T10:00:00Z', likeCompleted: false, boostCount: 1 },
    { title: 'Árbol', author: 'Zoe', updatedAt: '2026-09-22T10:00:00Z', likeCompleted: true, boostCount: 3 }
  ];

  assert.deepEqual(sortDesigns(records, 'title', 'asc').map((design) => design.title), ['Árbol', 'Zeta']);
  assert.deepEqual(sortDesigns(records, 'author', 'desc').map((design) => design.author), ['Zoe', 'Ana']);
  assert.deepEqual(sortDesigns(records, 'date', 'asc').map((design) => design.title), ['Zeta', 'Árbol']);
  assert.deepEqual(sortDesigns(records, 'like', 'desc').map((design) => design.title), ['Árbol', 'Zeta']);
  assert.deepEqual(sortDesigns(records, 'boost', 'asc').map((design) => design.boostCount), [1, 3]);
});

test('ordena diseños por categoría', () => {
  const records = [
    { title: 'Casa', category: 'Hogar' },
    { title: 'Figura', category: 'Arte y diseño' }
  ];

  assert.deepEqual(sortDesigns(records, 'category', 'asc').map((design) => design.title), ['Figura', 'Casa']);
  assert.deepEqual(normalizeDesignSort('category', 'asc'), { key: 'category', direction: 'asc' });
});

test('normaliza criterios de ordenación desconocidos', () => {
  assert.deepEqual(normalizeDesignSort('desconocido', 'asc'), { key: 'date', direction: 'asc' });
  assert.deepEqual(normalizeDesignSort('title', 'otra'), { key: 'title', direction: 'desc' });
});
