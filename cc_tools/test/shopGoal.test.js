import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeShopGoal, normalizeProduct } from '../src/shopGoal.js';

test('normaliza y conserva un objetivo de canje programado', () => {
  const goal = normalizeShopGoal({
    enabled: true,
    productId: 'product-1',
    name: 'K2 Combo',
    imageUrl: 'https://example.com/product.png',
    points: '12000',
    region: 'es',
    regionName: 'España',
    available: true,
    lastStatus: 'scheduled'
  });

  assert.equal(goal.enabled, true);
  assert.equal(goal.productId, 'product-1');
  assert.equal(goal.points, 12000);
  assert.equal(goal.region, 'ES');
  assert.equal(goal.regionName, 'España');
  assert.equal(goal.lastStatus, 'scheduled');
});

test('un objetivo vacío nunca queda activado', () => {
  const goal = normalizeShopGoal({ enabled: false, points: -1 });
  assert.equal(goal.enabled, false);
  assert.equal(goal.points, 0);
  assert.equal(goal.productId, '');
});

test('solo aplica el precio de primer canje cuando la promoción está activa', () => {
  const product = { id: 'filament', name: 'PETG', kwBeans: 5000, firstOrderKwBeans: 3473, stockStatus: 1 };
  assert.equal(normalizeProduct(product).points, 5000);
  assert.equal(normalizeProduct({ ...product, promotionType: 'first_order_discount' }).points, 3473);
});

test('reconoce falta de existencias y límites de canje de Creality', () => {
  const product = { id: 'filament', name: 'PETG', kwBeans: 3473, stockStatus: 1, goodsStatus: 4 };
  assert.equal(normalizeProduct(product).available, true);
  assert.equal(normalizeProduct({ ...product, stockStatus: 2 }).available, false);
  for (const goodsStatus of [1, 2, 3, 5, 6]) {
    assert.equal(normalizeProduct({ ...product, goodsStatus }).available, false);
  }
});

test('conserva una pausa tras reiniciar sin activar de nuevo el canje', () => {
  const goal = normalizeShopGoal({ enabled: false, productId: 'filament', lastStatus: 'submitting' });
  assert.equal(goal.enabled, false);
  assert.equal(goal.lastStatus, 'submitting');
});
