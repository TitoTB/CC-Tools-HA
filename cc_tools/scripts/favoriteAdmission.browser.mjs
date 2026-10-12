import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { readFavoriteProfileFromPage, requirePublishedFavoriteModels } from '../src/crealityFavoriteProfile.js';

const profileUrl = 'https://www.crealitycloud.com/es/user/123456789';
const empty = '<div class="loading-layout"><div class="empty_comp">Sin datos</div></div>';
const model = '<a href="https://www.crealitycloud.com/es/model-detail/123">Diseño publicado</a>';

test('valida diseños publicados antes del alta con un DOM real y sin red externa', async t => {
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'chrome' } : {}) });
  const context = await browser.newContext();
  await context.route('**/*', route => route.abort());
  const page = await context.newPage();
  try {
    for (const scenario of [
      { name: 'permite un perfil con un diseño', content: model },
      { name: 'rechaza un perfil vacío confirmado', content: empty, code: 'FAVORITE_PROFILE_NO_MODELS' },
      { name: 'no confunde una página incompleta con un perfil vacío', content: '', code: 'FAVORITE_PROFILE_MODELS_UNCONFIRMED' },
      { name: 'no confunde un fallo de carga con un perfil vacío', content: '<p>Error de conexión</p>', code: 'FAVORITE_PROFILE_MODELS_UNCONFIRMED' },
      { name: 'no cuenta modelos recomendados fuera del perfil', content: empty, outside: model, code: 'FAVORITE_PROFILE_NO_MODELS' },
      { name: 'no usa un mensaje vacío de otra sección', content: '', outside: empty, code: 'FAVORITE_PROFILE_MODELS_UNCONFIRMED' },
      { name: 'no acepta un perfil sin ID visible', content: model, id: '', code: 'FAVORITE_PROFILE_MODELS_UNCONFIRMED' },
      { name: 'rechaza un perfil con ID distinto', content: model, id: '999999', code: 'FAVORITE_PROFILE_NOT_FOUND' },
      { name: 'no acepta enlaces externos como diseños publicados', content: '<a href="https://example.com/model-detail/123">Ajeno</a>', code: 'FAVORITE_PROFILE_MODELS_UNCONFIRMED' },
      { name: 'un diseño tiene prioridad sobre un mensaje vacío residual', content: model + empty },
      { name: 'un diseño oculto no confirma disponibilidad', content: `<div hidden>${model}</div>`, code: 'FAVORITE_PROFILE_MODELS_UNCONFIRMED' },
      { name: 'un mensaje vacío oculto no confirma ausencia', content: `<div hidden>${empty}</div>`, code: 'FAVORITE_PROFILE_MODELS_UNCONFIRMED' }
    ]) await t.test(scenario.name, async () => {
      await page.setContent(`<div class="user-name"><span class="text-ellipsis">Maker</span></div><div class="creality-user-avatar"></div><div class="user-id">ID: ${scenario.id ?? '123456789'}</div>${scenario.outside || ''}<div class="user-model-container">${scenario.content}</div>`);
      const check = async () => {
        const profile = await readFavoriteProfileFromPage(page, profileUrl, { timeout: 50 });
        await requirePublishedFavoriteModels(page, profile, { timeout: 50, settleMs: 0 });
      };
      if (scenario.code) await assert.rejects(check, { code: scenario.code });
      else await check();
    });
  } finally { await context.close(); await browser.close(); }
});

test('la interfaz mantiene la lista intacta y muestra el aviso y Abrir perfil en el Log', async () => {
  const source = await fs.readFile(new URL('../public/assets/app.js', import.meta.url), 'utf8');
  const functions = ['addFavoriteProfile', 'renderRunDetails', 'parseFavoriteProfileUrlForLog', 'errorMessage', 'labelStatus', 'escapeHtml']
    .map(name => {
      const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
      assert.ok(start >= 0, name);
      const next = source.slice(start + 1).search(/\r?\n(?:async )?function /);
      return next < 0 ? source.slice(start) : source.slice(start, start + 1 + next);
    }).join('\n');
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'chrome' } : {}) });
  const context = await browser.newContext();
  await context.route('**/*', route => route.abort());
  const page = await context.newPage();
  try {
    await page.setContent('<input id="url"><button id="add-favorite-profile">Añadir</button><div id="favorites">Favorito existente</div><div id="toast"></div><div id="log"></div>');
    await page.evaluate(({ functions, profileUrl }) => {
      const setup = `
        const $ = selector => document.querySelector(selector);
        const fields = { favoriteProfileUrl: $('#url') };
        const state = { config: { crealityFavorites: [{ userId: 'existing' }] } };
        const toast = message => { $('#toast').textContent = message; };
        const uniqueDiagnostics = values => values;
        const renderDiagnostics = () => '';
        const renderFavoriteProfiles = () => { throw new Error('No debe modificar la lista'); };
        const api = async () => ({ ok: false, error: 'FAVORITE_PROFILE_NO_MODELS', profileUrl });
        const refresh = async () => {
          $('#log').innerHTML = labelStatus('warning') + renderRunDetails({ taskId: 'favoriteProfiles',
            details: { profileAdmission: { url: profileUrl } } });
        };
        ${functions}
        fields.favoriteProfileUrl.value = profileUrl;
        $('#add-favorite-profile').addEventListener('click', addFavoriteProfile);
      `;
      new Function('profileUrl', setup)(profileUrl);
    }, { functions, profileUrl });
    await page.getByRole('button', { name: 'Añadir' }).click();
    await page.getByRole('link', { name: 'Abrir perfil' }).waitFor();
    assert.equal(await page.locator('#favorites').textContent(), 'Favorito existente');
    assert.match(await page.locator('#toast').textContent(), /No se ha añadido a favoritos/);
    assert.match(await page.locator('#log').textContent(), /Aviso/);
    assert.equal(await page.getByRole('link', { name: 'Abrir perfil' }).getAttribute('href'), profileUrl);
    assert.equal(await page.locator('#url').inputValue(), profileUrl);
    assert.equal(await page.getByRole('button', { name: 'Añadir' }).isEnabled(), true);
  } finally { await context.close(); await browser.close(); }
});
