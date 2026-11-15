import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { installCookieConsentHandling } from './cookieConsent.js';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

// Own the process as well as the CDP connection: browser.close() on a CDP
// connection alone does not guarantee that an independently launched process exits.
export async function launchExternalChromium(profile, options = {}, onExit = () => {}) {
  await fs.mkdir(profile, { recursive: true });
  const port = await reservePort();
  const args = [
    `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1',
    // Match Playwright's storage feature defaults when sharing the same profile.
    // Chromium's field trials can otherwise select a different DOM storage backend.
    '--disable-field-trial-config',
    '--no-first-run', '--no-default-browser-check', '--no-sandbox', '--disable-dev-shm-usage',
    `--lang=${options.locale || 'es-ES'}`, '--window-size=1366,768',
    'about:blank'
  ];
  const child = spawn(options.executablePath || chromium.executablePath(), args, {
    env: { ...process.env, ...options.env }, windowsHide: true, stdio: 'ignore'
  });
  let exited = false, spawnFailed = false, browser, stopPromise;
  const exit = new Promise(resolve => {
    child.once('error', () => { spawnFailed = true; exited = true; resolve(); });
    child.once('exit', (code, signal) => { exited = true; onExit({ code, signal, pid: child.pid }); resolve(); });
  });
  const stop = () => stopPromise ||= (async () => {
    if (!exited && browser?.isConnected()) {
      try {
        // Leave only a blank tab in the session file. A normal Chromium launch
        // may otherwise restore work pages before Playwright can attach.
        const context = browser.contexts()[0];
        if (context) {
          const pages = context.pages();
          await Promise.race([(async () => {
            await context.newPage();
            await Promise.allSettled(pages.map(page => page.close()));
          })(), pause(2000)]);
        }
        const session = await browser.newBrowserCDPSession();
        await Promise.race([session.send('Browser.close').catch(() => {}), pause(2000)]);
      } catch {}
    }
    await Promise.race([exit, pause(3000)]);
    if (!exited) child.kill('SIGTERM');
    await Promise.race([exit, pause(1500)]);
    if (!exited) child.kill('SIGKILL');
    await Promise.race([exit, pause(1500)]);
    await browser?.close().catch(() => {});
    if (!exited) throw Object.assign(new Error('Chromium no terminó dentro del plazo.'), { code: 'BROWSER_STOP_TIMEOUT' });
  })();
  try {
    const deadline = Date.now() + (options.timeout || 45000);
    while (!exited && Date.now() < deadline) {
      try {
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, {
          timeout: 1000, isLocal: true,
          artifactsDir: options.downloadsPath || path.join(profile, 'cdp-downloads')
        });
        break;
      } catch { await pause(100); }
    }
    if (!browser || exited) throw Object.assign(new Error(spawnFailed
      ? 'No se pudo iniciar Chromium externo.' : 'No se pudo conectar con Chromium externo.'), { code: 'EXTERNAL_BROWSER_START_FAILED' });
    const context = browser.contexts()[0];
    if (!context) throw new Error('Chromium externo no creó un contexto.');
    // The default context and on-disk profile are shared by all modules.
    context.close = stop;
    browser.once('disconnected', () => { void stop().catch(() => {}); });
    await installCookieConsentHandling(context);
    return context;
  } catch (error) {
    await stop();
    throw error;
  }
}
