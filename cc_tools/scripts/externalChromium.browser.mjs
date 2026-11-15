import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { launchExternalChromium } from '../src/externalChromium.js';
import { inspectCrealityPageWithChallengeRecovery, observeCrealityPage } from '../src/crealityDiagnostics.js';

const executablePath = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined;
const launchOptions = { executablePath, timeout: 15000 };
const target = 'https://www.crealitycloud.com/es/test';

test('Chromium externo visible: webdriver, cookies, descarga, subida y cierre del proceso', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cctools-cdp-'));
  const profile = path.join(root, 'profile');
  let context, exits = [];
  t.after(async () => { await context?.close(); await fs.rm(root, { recursive: true, force: true }); });
  const seed = await chromium.launchPersistentContext(profile, { headless: false,
    ...(executablePath ? { executablePath } : {}) });
  try {
    await seed.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<p>Fixture</p>' }));
    await seed.pages()[0].goto(target);
    await seed.pages()[0].evaluate(() => localStorage.setItem('existing-session', 'seeded'));
    await seed.pages()[0].goto('about:blank');
  } finally { await seed.close(); }
  context = await launchExternalChromium(profile, launchOptions, event => exits.push(event));
  await context.route('**/*', route => route.fulfill(route.request().url().endsWith('/download')
    ? { contentType: 'application/octet-stream', headers: { 'content-disposition': 'attachment; filename="test.stl"' }, body: 'solid fixture' }
    : { contentType: 'text/html', body: '<title>Prueba local</title><a href="/download">Descargar</a><input type="file"><button onclick="window.open(\'/popup\')">Abrir</button>' }));
  let page = context.pages()[0];
  await page.goto(target);
  assert.equal(await page.evaluate(() => localStorage.getItem('existing-session')), 'seeded', 'existing standard profile remains readable in external mode');
  assert.equal(await page.evaluate(() => navigator.webdriver), false);
  await context.addCookies([{ name: 'cf_clearance', value: 'LOCAL_FIXTURE_ONLY', url: target, expires: Math.floor(Date.now()/1000)+3600 }]);
  await page.evaluate(() => localStorage.setItem('local-test', 'persisted'));
  const downloadPromise = page.waitForEvent('download');
  await page.getByText('Descargar', { exact: true }).click();
  const download = await downloadPromise;
  await download.saveAs(path.join(root, 'test.stl'));
  assert.equal(await fs.readFile(path.join(root, 'test.stl'), 'utf8'), 'solid fixture');
  await page.locator('input').setInputFiles({ name: 'test.stl', mimeType: 'application/octet-stream', buffer: Buffer.from('solid fixture') });
  assert.equal(await page.locator('input').evaluate(el => el.files[0].name), 'test.stl');
  const popupPromise = page.waitForEvent('popup'); await page.getByText('Abrir', { exact: true }).click();
  const popup = await popupPromise; await popup.waitForLoadState();
  assert.equal(popup.context(), context); assert.equal(await popup.evaluate(() => navigator.webdriver), false);
  await popup.close();
  await context.close();
  assert.equal(exits.length, 1); assert.equal(exits[0].code, 0);
  context = await launchExternalChromium(profile, launchOptions, event => exits.push(event));
  await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<p>Fixture</p>' }));
  page = context.pages()[0]; await page.goto(target);
  assert.equal(await page.evaluate(() => localStorage.getItem('local-test')), 'persisted', 'localStorage survives an external-to-external restart');
  await context.close();
  context = await launchExternalChromium(profile, launchOptions, event => exits.push(event));
  await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<p>Fixture</p>' }));
  assert.ok(context.pages().every(page => page.url() === 'about:blank'));
  page = context.pages()[0]; await page.goto(target);
  assert.equal((await context.cookies()).find(c => c.name === 'cf_clearance').value, 'LOCAL_FIXTURE_ONLY');
  assert.equal(await page.evaluate(() => localStorage.getItem('local-test')), 'persisted');
  assert.equal(await page.evaluate(() => navigator.webdriver), false);
  await context.close(); assert.equal(exits.length, 3);
});

test('CDP conserva la recuperación pasiva y el resultado de intervención manual de 1.0.47', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cctools-cdp-challenge-'));
  const context = await launchExternalChromium(root, launchOptions);
  t.after(async () => { await context.close(); await fs.rm(root, { recursive: true, force: true }); });
  await context.route('**/*', route => route.fulfill({ contentType: 'text/html', status: 429,
    headers: { 'cf-mitigated': 'challenge' },
    body: '<title>Un momento</title><form id="challenge-form">Verificación de seguridad en curso</form>' }));
  const page = context.pages()[0];
  const observer = observeCrealityPage(page, 'test');
  t.after(() => observer.stop());
  await page.goto(target);
  const pending = await inspectCrealityPageWithChallengeRecovery(page, observer, {
    challengeTimeout: 1000, challengeSettleMs: 250
  });
  assert.equal(pending.code, 'SECURITY_CHALLENGE');
  assert.equal(pending.challengeResolution, 'manual_required');
  assert.equal(page.isClosed(), false);
  // Simulate a resolved document locally; never contact or click a real challenge.
  await page.evaluate(() => {
    setTimeout(() => {
      document.title = 'Modelo de prueba';
      document.body.innerHTML = '<h1>Modelo de prueba</h1><p>Contenido de prueba disponible con archivos y descripción.</p>';
    }, 400);
  });
  assert.equal(await inspectCrealityPageWithChallengeRecovery(page, observer, {
    challengeTimeout: 5000, challengeSettleMs: 250
  }), null);
  assert.equal(page.context(), context);
});

test('un ejecutable inexistente falla sin dejar el perfil ocupado', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cctools-cdp-failed-'));
  try {
    await assert.rejects(launchExternalChromium(root, { executablePath: path.join(root, 'missing'), timeout: 1000 }), { code: 'EXTERNAL_BROWSER_START_FAILED' });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
