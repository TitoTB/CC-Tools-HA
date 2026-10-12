import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { isConfirmedEmptyFavoritePage } from '../src/favoriteModelIndex.js';

test('distingue un perfil sin diseños de una página incompleta o ajena', async t => {
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'chrome' } : {}) });
  const context = await browser.newContext();
  await context.route('**/*', route => route.abort());
  const page = await context.newPage();
  const profile = { userId: '1485232057' };
  const empty = '<div class="loading-layout"><div class="empty_comp">Sin datos</div></div>';
  const cases = [
    { name: 'perfil correcto con Sin datos explícito', content: empty, expected: true },
    { name: 'una página todavía vacía no confirma ausencia de diseños', content: '', expected: false },
    { name: 'un mensaje vacío de otra sección no sirve', outside: empty, content: '', expected: false },
    { name: 'un estado vacío oculto no sirve', content: `<div hidden>${empty}</div>`, expected: false },
    { name: 'un error de carga no se convierte en Sin diseños', content: '<p>Error de conexión</p>', expected: false },
    { name: 'un ID diferente no modifica el índice del favorito', id: '999999', content: empty, expected: false },
    { name: 'un perfil sin ID visible no confirma un índice vacío', id: '', content: empty, expected: false },
    { name: 'los diseños tienen prioridad frente a un mensaje vacío residual', content: `${empty}<a href="/es/model-detail/123">Diseño</a>`, expected: false },
    { name: 'una identidad no verificada no confirma un índice vacío', identity: null, content: empty, expected: false },
  ];
  try {
    for (const scenario of cases) await t.test(scenario.name, async () => {
      await page.setContent(`<div class="user-id">ID:${scenario.id ?? profile.userId}</div>${scenario.outside || ''}<div class="user-model-container">${scenario.content}</div>`);
      assert.equal(await isConfirmedEmptyFavoritePage(page, profile, scenario.identity === null ? null : profile), scenario.expected);
    });
  } finally { await context.close(); await browser.close(); }
});
