import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { publishedDesignState } from '../src/crealityFavoriteProfile.js';

test('distingue perfiles con diseños, vacíos e incompletos', async (t) => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.platform === 'win32' ? { channel: 'chrome' } : {})
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    const cases = [
      ['available', '<a href="/es/model-detail/example">Diseño</a>'],
      ['empty', '<div class="loading-layout"><div class="empty_comp">Sin datos</div></div>'],
      ['unknown', '<div class="loading-layout"></div>']
    ];
    for (const [expected, content] of cases) await t.test(expected, async () => {
      await page.setContent(`<div class="user-model-container">${content}</div>`);
      assert.equal(await publishedDesignState(page, { timeout: 20 }), expected);
    });
  } finally {
    await context.close();
    await browser.close();
  }
});
