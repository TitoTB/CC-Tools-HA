import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeShopOrder } from '../src/shopOrders.js';
import {
  archiveShopOrder,
  mergeShopOrdersState,
  shopOrdersRefreshDue,
  shippedShopOrderTransitions
} from '../src/shopOrdersState.js';

test('normaliza los pedidos pendientes y enviados de la tienda', () => {
  const pending = normalizeShopOrder({
    id: 'pending',
    goodsName: 'Filamento',
    compressPic: 'https://example.test/filament.webp',
    kwBeans: 3473,
    buyNum: 1,
    orderStatus: 2,
    createTime: 1790188849,
    lastModifyTime: 1790188849
  });
  const shipped = normalizeShopOrder({
    id: 'shipped',
    goodsName: 'Tarjeta',
    kwBeans: 10,
    orderStatus: 3,
    createTime: 1788723480
  });

  assert.equal(pending.status, 'Pendiente');
  assert.equal(pending.statusKind, 'pending');
  assert.equal(pending.points, 3473);
  assert.equal(pending.createdAt, '2026-09-23T18:40:49.000Z');
  assert.equal(shipped.status, 'Enviado');
  assert.equal(shipped.statusKind, 'shipped');
});

test('conserva un pedido archivado hasta que cambia su estado', () => {
  const now = new Date('2026-09-27T08:00:00.000Z');
  const initial = mergeShopOrdersState({}, [{
    id: 'one',
    title: 'Producto',
    status: 'Enviado',
    statusKind: 'shipped',
    statusKey: '3:'
  }], now);
  const archived = archiveShopOrder(initial, 'one', new Date('2026-09-27T09:00:00.000Z'));
  assert.equal(archived.items[0].archived, true);

  const unchanged = mergeShopOrdersState(archived, [{
    id: 'one',
    title: 'Producto',
    status: 'Enviado',
    statusKind: 'shipped',
    statusKey: '3:'
  }], new Date('2026-09-28T09:00:00.000Z'));
  assert.equal(unchanged.items[0].archived, true);

  const changed = mergeShopOrdersState(unchanged, [{
    id: 'one',
    title: 'Producto',
    status: 'Estado 6',
    statusKind: 'neutral',
    statusKey: '6:'
  }], new Date('2026-09-29T09:00:00.000Z'));
  assert.equal(changed.items[0].archived, false);
});

test('solo permite archivar pedidos enviados', () => {
  const state = mergeShopOrdersState({}, [{
    id: 'pending',
    title: 'Producto pendiente',
    status: 'Pendiente',
    statusKind: 'pending',
    statusKey: '2:'
  }]);
  assert.equal(archiveShopOrder(state, 'pending'), null);
});

test('notifica exclusivamente la transición de pendiente a enviado', () => {
  const previous = mergeShopOrdersState({}, [{
    id: 'existing',
    title: 'Pedido existente',
    status: 'Pendiente',
    statusKind: 'pending',
    statusKey: '2:'
  }]);
  const next = mergeShopOrdersState(previous, [{
    id: 'existing',
    title: 'Pedido existente',
    status: 'Enviado',
    statusKind: 'shipped',
    statusKey: '3:'
  }, {
    id: 'imported',
    title: 'Pedido antiguo importado',
    status: 'Enviado',
    statusKind: 'shipped',
    statusKey: '3:'
  }]);

  assert.deepEqual(shippedShopOrderTransitions(previous, next).map((order) => order.id), ['existing']);
  assert.deepEqual(shippedShopOrderTransitions({}, next), []);
});

test('actualiza pedidos una vez cada 24 horas y reintenta errores tras una hora', () => {
  const now = new Date('2026-09-27T12:00:00.000Z');
  assert.equal(shopOrdersRefreshDue({ updatedAt: '2026-09-26T13:00:00.000Z' }, now), false);
  assert.equal(shopOrdersRefreshDue({ updatedAt: '2026-09-26T11:59:59.000Z' }, now), true);
  assert.equal(shopOrdersRefreshDue({ lastAttemptAt: '2026-09-27T11:30:00.000Z' }, now), false);
  assert.equal(shopOrdersRefreshDue({ lastAttemptAt: '2026-09-27T10:30:00.000Z' }, now), true);
});
