import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isNavigationTimeout,
  navigateToCrealityPage,
  sameNavigationTarget
} from '../src/crealityNavigation.js';

test('compara el destino conservando los parámetros solicitados', () => {
  assert.equal(
    sameNavigationTarget(
      'https://www.crealitycloud.com/es/incentive-points?thirdType=earn-points&source=task',
      'https://www.crealitycloud.com/es/incentive-points?thirdType=earn-points'
    ),
    true
  );
  assert.equal(
    sameNavigationTarget(
      'https://www.crealitycloud.com/es/incentive-points?thirdType=earn-points',
      'https://www.crealitycloud.com/es/model-detail/example'
    ),
    false
  );
});

test('acepta una navegación lenta cuando el documento solicitado ya está disponible', async () => {
  const target = 'https://www.crealitycloud.com/es/incentive-points?thirdType=earn-points';
  const timeout = new Error('page.goto: Timeout 45000ms exceeded.');
  const page = {
    goto: async () => { throw timeout; },
    url: () => target,
    locator: () => ({ first: () => ({ isVisible: async () => true }) }),
    waitForTimeout: async () => {}
  };

  await assert.doesNotReject(() => navigateToCrealityPage(page, target));
  assert.equal(isNavigationTimeout(timeout), true);
});

test('reintenta con commit si el primer intento permanece en la página anterior', async () => {
  const target = 'https://www.crealitycloud.com/es/model-detail/example';
  let current = 'https://www.crealitycloud.com/es/incentive-points?thirdType=earn-points';
  const calls = [];
  const page = {
    goto: async (_url, options) => {
      calls.push(options.waitUntil);
      if (calls.length === 2) current = target;
    },
    url: () => current,
    waitForTimeout: async () => {}
  };

  await navigateToCrealityPage(page, target);
  assert.deepEqual(calls, ['domcontentloaded', 'commit']);
});
