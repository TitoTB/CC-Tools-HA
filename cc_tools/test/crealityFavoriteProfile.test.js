import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFavoriteProfileFromPage, publishedDesignState } from '../src/crealityFavoriteProfile.js';

test('lee la identidad del perfil con el HTML actual y anterior de Creality Cloud', async t => {
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'chrome' } : {}) });
  const context = await browser.newContext();
  await context.route('**/*', route => route.abort());
  const page = await context.newPage();
  const avatar = 'https://pic2-cdn.creality.com/avatar/profile';
  const cases = [
    { name: 'nombre corto sin text-ellipsis', html: '<span class="">Maker</span>', expected: 'Maker' },
    { name: 'nombre anterior con título completo', html: '<span class="text-ellipsis" title="Nombre completo">Nombre…</span>', expected: 'Nombre completo' },
    { name: 'formato anterior anidado', html: '<div><span class="text-ellipsis">Maker</span></div>', expected: 'Maker' },
    { name: 'otro ID visible', html: '<span>Maker</span>', id: '999', error: true },
    { name: 'sin ID verificable', html: '<span>Maker</span>', id: '', error: true },
    { name: 'página incompleta', html: '', error: true },
    { name: 'nombre oculto', html: '<span hidden>Maker</span>', error: true },
    { name: 'sin foto de perfil', html: '<span>Maker</span>', expected: 'Maker', noAvatar: true }
  ];
  try {
    for (const scenario of cases) await t.test(scenario.name, async () => {
      await page.setContent(`<header><div class="creality-user-avatar" style="background-image:url(https://pic2-cdn.creality.com/avatar/logged-in-user)"></div></header>
        <aside>${scenario.noAvatar ? '' : `<div class="user-avatar-box"><div class="creality-user-avatar" style="background-image:url(${avatar})"></div></div>`}
        <div class="user-name">${scenario.html}</div><div class="user-id">${scenario.id === '' ? '' : `ID: ${scenario.id || '123456789'}`}</div></aside>
        <div class="user-model-container"><a href="/es/model-detail/example">Diseño de prueba</a></div>`);
      const read = () => readFavoriteProfileFromPage(page, 'https://www.crealitycloud.com/es/user/123456789/model', { timeout: 150 });
      if (scenario.error) {
        await assert.rejects(read, { code: 'FAVORITE_PROFILE_NOT_FOUND' });
      } else {
        const profile = await read();
        assert.equal(profile.name, scenario.expected);
        assert.equal(profile.userId, '123456789');
        assert.equal(profile.profileUrl, 'https://www.crealitycloud.com/es/user/123456789');
        assert.equal(profile.avatarUrl, scenario.noAvatar ? '' : avatar);
        assert.equal(await publishedDesignState(page, { timeout: 150 }), 'available');
      }
    });
  } finally { await context.close(); await browser.close(); }
});
