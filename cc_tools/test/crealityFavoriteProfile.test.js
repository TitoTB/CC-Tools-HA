import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFavoriteProfileFromPage } from '../src/crealityFavoriteProfile.js';

const PROFILE_URL = 'https://www.crealitycloud.com/es/user/123456789';

test('lee perfiles favoritos con el HTML actual y anterior de Creality Cloud', async (t) => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.platform === 'win32' ? { channel: 'chrome' } : {})
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    const cases = [
      ['HTML actual sin text-ellipsis', '<div class="user-name"><span>Maker actual</span></div>', 'Maker actual'],
      ['HTML anterior con title', '<div class="user-name"><span class="text-ellipsis" title="Maker anterior">Texto truncado</span></div>', 'Maker anterior'],
      ['HTML anterior anidado', '<div class="user-name"><div><span class="text-ellipsis">Maker anidado</span></div></div>', 'Maker anidado']
    ];

    for (const [label, nameHtml, expectedName] of cases) await t.test(label, async () => {
      await page.setContent(`
        <div class="user-avatar-box">
          <div class="creality-user-avatar" style="background-image: url('https://pic2-cdn.creality.com/avatar/example.webp')"></div>
        </div>
        ${nameHtml}
        <div class="user-id">ID: 123456789</div>
      `);
      const profile = await readFavoriteProfileFromPage(page, PROFILE_URL, { timeout: 1000 });
      assert.equal(profile.name, expectedName);
      assert.equal(profile.userId, '123456789');
      assert.equal(profile.avatarUrl, 'https://pic2-cdn.creality.com/avatar/example.webp');
      assert.equal(profile.profileUrl, PROFILE_URL);
    });
  } finally {
    await context.close();
    await browser.close();
  }
});

test('rechaza páginas incompletas o pertenecientes a otro perfil', async (t) => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.platform === 'win32' ? { channel: 'chrome' } : {})
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    const cases = [
      ['ID diferente', '<div class="user-name"><span>Otro perfil</span></div><div class="user-id">ID: 987654321</div>'],
      ['ID ausente', '<div class="user-name"><span>Perfil sin ID</span></div>'],
      ['nombre ausente', '<div class="user-id">ID: 123456789</div>'],
      ['nombre oculto', '<div class="user-name"><span style="display:none">Perfil oculto</span></div><div class="user-id">ID: 123456789</div>']
    ];

    for (const [label, html] of cases) await t.test(label, async () => {
      await page.setContent(html);
      await assert.rejects(
        readFavoriteProfileFromPage(page, PROFILE_URL, { timeout: 250 }),
        (error) => error?.code === 'FAVORITE_PROFILE_NOT_FOUND'
      );
    });
  } finally {
    await context.close();
    await browser.close();
  }
});

test('admite perfiles sin avatar y no toma avatares ajenos a la ficha', async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.platform === 'win32' ? { channel: 'chrome' } : {})
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.setContent(`
      <header><div class="creality-user-avatar" style="background-image: url('https://pic2-cdn.creality.com/avatar/header.webp')"></div></header>
      <div class="user-name"><span>Maker sin avatar</span></div>
      <div class="user-id">ID: 123456789</div>
    `);
    const profile = await readFavoriteProfileFromPage(page, PROFILE_URL, { timeout: 1000 });
    assert.equal(profile.name, 'Maker sin avatar');
    assert.equal(profile.avatarUrl, '');
  } finally {
    await context.close();
    await browser.close();
  }
});
