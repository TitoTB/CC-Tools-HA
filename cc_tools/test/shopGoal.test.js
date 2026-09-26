import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeShopGoal } from '../src/shopGoal.js';

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
