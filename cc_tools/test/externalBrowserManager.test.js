import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';

function fixture() {
  const launches = [];
  const page = { goto: async () => {}, url: () => 'https://www.crealitycloud.com/es/test' };
  const scope = vm.createContext({ process, path, console, setTimeout, clearTimeout,
    browserSessionDir: () => '/data/browser-session',
    normalizeCaughtError: error => error,
    confirmAuthenticatedSession: async () => {},
    launchExternalChromium: async (profile, options) => {
      const context = new EventEmitter();
      context.browser = () => ({ version: () => 'fixture' });
      context.pages = () => [page];
      context.close = async () => { context.closed = true; context.emit('close'); };
      launches.push({ profile, options, context });
      return context;
    }
  });
  const source = fs.readFileSync(new URL('../src/browserManager.js', import.meta.url), 'utf8')
    .replace(/^import[^\n]+;\r?$/gm, '').replace(/^export /gm, '');
  vm.runInContext(source + `
    recoverBrowserProfile = async () => ({ recovered: true });
    assertAuthenticatedSession = async () => ({ confirmAuthenticated: false });
  `, scope);
  return { scope, launches };
}

test('automatización, recuperación y acceso manual usan el mismo perfil externo visible', async () => {
  const { scope, launches } = fixture();
  await scope.withAutomationBrowser({ downloadsPath: '/data/downloads/batch' }, async context => {
    assert.equal(context, launches[0].context);
    assert.equal(scope.browserManagerState().mode, 'automation');
    await assert.rejects(scope.openInteractiveBrowser('https://www.crealitycloud.com/es/test'), { code: 'BROWSER_BUSY' });
  });
  assert.equal(launches[0].context.closed, true);
  assert.equal(launches[0].options.downloadsPath, '/data/downloads/batch');
  await scope.attemptRememberedSessionLogin();
  await scope.openInteractiveBrowser('https://www.crealitycloud.com/es/test');
  await assert.rejects(scope.withAutomationBrowser({}, () => {}), { code: 'REMOTE_BROWSER_OPEN' });
  await scope.closeInteractiveBrowser();
  assert.equal(launches.length, 3);
  for (const launch of launches) {
    assert.equal(launch.profile, path.join('/data/browser-session', 'chromium'));
    assert.equal(launch.options.headless, false);
    assert.equal(launch.context.closed, true);
  }
});

test('el reinicio de una descarga cierra el proceso anterior y conserva su directorio', async () => {
  const { scope, launches } = fixture();
  await scope.withAutomationBrowser({}, async () => {
    await scope.restartAutomationBrowser({ downloadsPath: '/data/downloads/retry' });
    assert.equal(launches[0].context.closed, true);
    assert.equal(launches[1].options.downloadsPath, '/data/downloads/retry');
    assert.equal(launches[1].profile, launches[0].profile);
  });
  assert.equal(launches[1].context.closed, true);
});

test('el fallo de una tarea y el apagado cierran Chromium externo', async () => {
  const { scope, launches } = fixture();
  await assert.rejects(scope.withAutomationBrowser({}, async () => { throw new Error('fixture failure'); }), /fixture failure/);
  assert.equal(launches[0].context.closed, true);
  await scope.openInteractiveBrowser('https://www.crealitycloud.com/es/test');
  await scope.shutdownBrowser();
  assert.equal(launches[1].context.closed, true);
  assert.equal(scope.browserManagerState().active, false);
});

test('bloquea tareas y acceso manual hasta que Chromium termina de cerrar el perfil', async () => {
  const { scope, launches } = fixture();
  let entered, finish;
  const closing = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { finish = resolve; });
  const task = scope.withAutomationBrowser({}, async context => {
    const close = context.close;
    context.close = async () => { entered(); await gate; await close(); };
  });
  await closing;
  assert.equal(scope.browserManagerState().mode, 'closing');
  await assert.rejects(scope.withAutomationBrowser({}, async () => {}), { code: 'BROWSER_BUSY' });
  await assert.rejects(scope.openInteractiveBrowser('https://www.crealitycloud.com/es/test'), { code: 'BROWSER_BUSY' });
  let stopped = false;
  const stop = scope.shutdownBrowser().then(() => { stopped = true; });
  await Promise.resolve();
  assert.equal(stopped, false);
  finish(); await Promise.all([task, stop]);
  assert.equal(launches[0].context.closed, true);
  assert.equal(scope.browserManagerState().mode, 'idle');
});
