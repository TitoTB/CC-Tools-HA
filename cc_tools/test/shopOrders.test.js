import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeShopOrder } from '../src/shopOrders.js';
import {
  archiveShopOrder,
  mergeShopOrdersState,
  shopOrdersRefreshDue,
  shippedShopOrderTransitions
} from '../src/shopOrdersState.js';

test('normaliza los pedidos pendientes, disponibles y enviados de la tienda', () => {
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
  const available = normalizeShopOrder({
    id: 'available',
    orderNo: 'CO260924Q7QEjejo',
    goodsName: 'Hyper PETG 1,75mm Filament 1KG-DTC discout code',
    kwBeans: 3473,
    orderStatus: 1,
    couponCode: 'LZfCHXFkJJ4',
    useUrl: 'https://store.creality.com/es/products/hyper-petg?discountCode=LZfCHXFkJJ4'
  });

  assert.equal(pending.status, 'Pendiente');
  assert.equal(pending.statusKind, 'pending');
  assert.equal(pending.points, 3473);
  assert.equal(pending.createdAt, '2026-09-23T18:40:49.000Z');
  assert.equal(shipped.status, 'Enviado');
  assert.equal(shipped.statusKind, 'shipped');
  assert.equal(available.status, 'Disponible');
  assert.equal(available.statusKind, 'available');
  assert.match(available.useUrl, /^https:\/\/store\.creality\.com\//);
  assert.equal(normalizeShopOrder({
    id: 'unsafe',
    goodsName: 'Cupón',
    orderStatus: 1,
    couponCode: 'code',
    useUrl: 'https://example.test/phishing'
  }).useUrl, '');
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

test('solo permite archivar pedidos realmente enviados', () => {
  const state = mergeShopOrdersState({}, [{
    id: 'pending',
    title: 'Producto pendiente',
    status: 'Pendiente',
    statusKind: 'pending',
    statusKey: '2:'
  }]);
  assert.equal(archiveShopOrder(state, 'pending'), null);
  const available = mergeShopOrdersState({}, [{
    id: 'available',
    title: 'Cupón disponible',
    status: 'Disponible',
    statusKind: 'available',
    statusKey: '1::coupon'
  }]);
  assert.equal(archiveShopOrder(available, 'available'), null);
  const shipped = mergeShopOrdersState({}, [{
    id: 'shipped',
    title: 'Pedido enviado',
    status: 'Enviado',
    statusKind: 'shipped',
    statusKey: '3:'
  }]);
  assert.equal(archiveShopOrder(shipped, 'shipped').items[0].archived, true);
});

test('notifica exclusivamente la transición de pendiente a disponible o enviado', () => {
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
    status: 'Disponible',
    statusKind: 'available',
    statusKey: '1::coupon'
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
  assert.equal(shopOrdersRefreshDue({ schemaVersion: 2, updatedAt: '2026-09-26T13:00:00.000Z' }, now), false);
  assert.equal(shopOrdersRefreshDue({ schemaVersion: 2, updatedAt: '2026-09-26T11:59:59.000Z' }, now), true);
  assert.equal(shopOrdersRefreshDue({ schemaVersion: 2, lastAttemptAt: '2026-09-27T11:30:00.000Z' }, now), false);
  assert.equal(shopOrdersRefreshDue({ schemaVersion: 2, lastAttemptAt: '2026-09-27T10:30:00.000Z' }, now), true);
  assert.equal(shopOrdersRefreshDue({ updatedAt: '2026-09-27T11:59:00.000Z' }, now), true);
});
