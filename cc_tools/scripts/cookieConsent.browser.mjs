import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { launchExternalChromium } from '../src/externalChromium.js';
import { installCookieConsentHandling } from '../src/cookieConsent.js';

const target = 'https://www.crealitycloud.com/es/test';
const executablePath = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined;
const banner = `<div id="cc-main"><div class="cm" role="dialog" aria-hidden="false">
  <h2>We use cookies!</h2><button data-role="all">Accept all</button>
  <button data-role="necessary">Reject all</button><button data-role="show">Cookie Settings</button>
</div></div>`;
const fixture = `<body><h1>Modelo local de prueba</h1><script>
window.accepts = 0; window.rejects = 0;
function showBanner() {
  document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(banner)});
  document.querySelector('[data-role="all"]').onclick = () => { window.accepts++; };
  document.querySelector('[data-role="necessary"]').onclick = () => {
    window.rejects++;
    localStorage.setItem('fixtureConsent', 'necessary');
    document.cookie = '_ga=; Max-Age=0; Path=/';
    document.querySelector('#cc-main').remove();
  };
}
if (!localStorage.getItem('fixtureConsent')) setTimeout(showBanner, 100);
</script></body>`;

test('rechaza el aviso tardío y conserva cookies necesarias, almacenamiento y elección al reabrir Chromium', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-consent-'));
  let context;
  t.after(async () => { await context?.close(); await fs.rm(root, { recursive: true, force: true }); });
  context = await launchExternalChromium(root, { executablePath });
  await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: fixture }));
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const required = ['session_test', 'cf_clearance', '__cf_bm'].map(name => ({ name, value: 'fixture-' + name,
    url: target, expires, httpOnly: true, secure: true }));
  await context.addCookies([...required, { name: '_ga', value: 'optional', url: new URL(target).origin + '/', expires }]);
  let page = context.pages()[0];
  await page.goto(target);
  await page.evaluate(() => localStorage.setItem('session-fixture', 'kept'));
  await page.waitForFunction(() => localStorage.getItem('fixtureConsent') === 'necessary');
  assert.equal(await page.evaluate(() => window.accepts), 0);
  assert.equal(await page.evaluate(() => window.rejects), 1);
  assert.equal(await page.locator('#cc-main').count(), 0);
  const before = await context.cookies(target);
  assert.equal(before.some(c => c.name === '_ga'), false);
  for (const cookie of required) assert.equal(before.find(c => c.name === cookie.name)?.value, cookie.value);
  // A new tab and a reopened process both retain the site's own choice.
  const second = await context.newPage(); await second.goto(target);
  assert.equal(await second.evaluate(() => localStorage.getItem('fixtureConsent')), 'necessary');
  await context.close();
  context = await launchExternalChromium(root, { executablePath });
  await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: fixture }));
  page = context.pages()[0]; await page.goto(target);
  assert.equal(await page.evaluate(() => localStorage.getItem('fixtureConsent')), 'necessary');
  assert.equal(await page.evaluate(() => localStorage.getItem('session-fixture')), 'kept');
  assert.equal(await page.evaluate(() => window.rejects), 0);
  const after = await context.cookies(target);
  for (const cookie of required) assert.equal(after.find(c => c.name === cookie.name)?.value, cookie.value);
});

test('solo actúa sobre el aviso de consentimiento de Creality, sin tocar preferencias, desafíos ni otras webs', async t => {
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  t.after(() => browser.close());
  const context = await browser.newContext();
  await installCookieConsentHandling(context);
  await installCookieConsentHandling(context);
  const scenarios = [
    { url: 'https://other.test/', html: banner },
    { url: 'https://crealitycloud.com.other.test/', html: banner },
    { url: target, html: banner.replace('class="cm"', 'class="pm"') },
    { url: target, html: '<button data-role="necessary">Reject all</button><button>Soy humano</button>' },
    { url: target, html: banner.replace('data-role="necessary"', 'data-role="unknown"') },
    { url: target, html: banner.replace('aria-hidden="false"', 'aria-hidden="true"') },
    { url: target, html: `<iframe srcdoc='${banner}'></iframe>` }
  ];
  for (const scenario of scenarios) {
    await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body:
      `<body>${scenario.html}<script>window.clicks=0;document.addEventListener('click',()=>window.clicks++);</script></body>` }));
    const page = await context.newPage(); await page.goto(scenario.url);
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => window.clicks), 0, scenario.html);
    for (const frame of page.frames().slice(1)) assert.equal(await frame.locator('button[data-role="necessary"]').count(), 1);
    await page.close(); await context.unroute('**/*');
  }
  // Also attach to a page that was already loaded when the context was connected.
  const existing = await browser.newContext();
  await existing.route('**/*', route => route.fulfill({ contentType: 'text/html', body: fixture }));
  const page = await existing.newPage(); await page.goto(target);
  await page.locator('#cc-main').waitFor();
  await installCookieConsentHandling(existing);
  await page.waitForFunction(() => window.rejects === 1);
  assert.equal(await page.evaluate(() => window.accepts), 0);
  await page.evaluate(() => localStorage.setItem('fixtureConsent', 'all'));
  await page.reload(); await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => localStorage.getItem('fixtureConsent')), 'all');
  assert.equal(await page.evaluate(() => window.rejects), 0);
});
