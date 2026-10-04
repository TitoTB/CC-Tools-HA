import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

let browser, server, dataDir, baseUrl;
before(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cctools-setup-'));
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['src/server.js'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    windowsHide: true,
    env: { ...process.env, CCTOOLS_HOST: '127.0.0.1', CCTOOLS_PORT: String(port), CCTOOLS_DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  server.stdout.on('data', data => { logs += data; });
  server.stderr.on('data', data => { logs += data; });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { ready = (await (await fetch(`${baseUrl}/api/status`)).json()).ok; } catch {}
    if (ready || server.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(ready, true, logs);
  browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'chrome' } : {}) });
});

after(async () => {
  await browser?.close();
  if (server && server.exitCode === null) {
    const closed = once(server, 'exit');
    server.kill();
    await closed;
  }
  if (dataDir) await fs.rm(dataDir, { recursive: true, force: true });
});

test('Telegram conserva el paso del asistente y las descargas parten de 30', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // All account actions are simulated: no Telegram message or Creality login is sent.
  await page.route('**/api/tasks/creality/login/close', route => route.fulfill({ json: { ok: true } }));
  await page.route('**/api/creality/profile/refresh', route => route.fulfill({ json: { ok: false } }));
  await page.route('**/api/points/**', route => route.fulfill({ json: { ok: false } }));
  await page.route('**/api/shop/**', route => route.fulfill({ json: { ok: false } }));
  let telegramTests = 0;
  await page.route('**/api/telegram/test', route => {
    telegramTests++;
    return route.fulfill({ json: { ok: true } });
  });
  try {
    await page.goto(baseUrl);
    await page.waitForSelector('#wizard-modal:not([hidden])');
    await page.locator('#wizard-next').click();
    await page.waitForSelector('[data-wizard-step="2"].is-visible');
    await page.locator('#wizard-telegram-token').fill('test-token');
    await page.locator('#wizard-telegram-chat').fill('12345');
    await page.locator('#wizard-test-telegram').click();
    await page.waitForFunction(() => document.querySelector('#toast').textContent === 'Mensaje enviado.');
    assert.equal(telegramTests, 1);
    assert.equal(await page.locator('[data-wizard-step="2"]').isVisible(), true);
    await page.locator('#wizard-next').click();
    await page.waitForSelector('[data-wizard-step="3"].is-visible');
    await page.locator('#wizard-next').click();
    await page.waitForSelector('#wizard-modal', { state: 'hidden' });
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#models-daily-limit').value === '30');
    assert.equal(await page.locator('#wizard-modal').isVisible(), false);
    await page.locator('#open-models-config svg').click();
    assert.equal(await page.locator('#models-daily-limit').inputValue(), '30');
    assert.equal(await page.locator('#models-window-end').inputValue(), '14:00');
    await page.locator('#close-models-config').click();
    await page.locator('#open-collections-config svg').click();
    assert.equal(await page.locator('#run-collections-now').isVisible(), true);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
