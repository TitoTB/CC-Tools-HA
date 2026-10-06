import fs from 'fs/promises';
import path from 'path';
import { chromium } from 'playwright';
import { browserSessionDir } from './storage.js';
import { inspectCrealityPage } from './crealityDiagnostics.js';
import { isNavigationTimeout, navigateToCrealityPage } from './crealityNavigation.js';

const PROFILE_LOCK_FILES = ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lock'];
const SESSION_CHECK_URL = 'https://www.crealitycloud.com/es';
let activeContext = null;
let activeMode = '';
let activeBrowserVersion = '';

export async function withAutomationBrowser(options, callback) {
  if (activeMode === 'interactive') {
    await closeActiveContext();
  }
  if (activeMode) {
    throw browserError('BROWSER_BUSY', 'Ya hay otra operación utilizando el navegador.', false);
  }

  activeMode = 'automation';
  try {
    activeContext = await launchWithRecovery(
      { ...baseOptions(), ...(options || {}) },
      { allowHeadlessFallback: true }
    );
    activeBrowserVersion = activeContext.browser()?.version() || '';
    watchContext(activeContext);
    await assertAuthenticatedSession(activeContext);
    return await callback(activeContext);
  } catch (error) {
    throw normalizeBrowserError(error);
  } finally {
    await closeActiveContext();
  }
}

export async function withIsolatedBrowser(options, callback) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    colorScheme: 'light',
    locale: process.env.CCTOOLS_BROWSER_LOCALE || 'es-ES',
    timezoneId: process.env.TZ || 'Europe/Madrid',
    ...(options || {})
  });
  try {
    return await callback(context);
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

export async function withParallelSessionBrowser(options, callback) {
  if (activeMode !== 'automation' || !activeContext) {
    return withAutomationBrowser(options, callback);
  }

  const storageState = await activeContext.storageState().catch(() => null);
  if (!storageState) {
    throw browserError('BROWSER_BUSY', 'Ya hay otra operación utilizando el navegador.', false);
  }
  return withIsolatedBrowser({ ...(options || {}), storageState }, callback);
}

export async function restartAutomationBrowser(options = {}) {
  if (activeMode && activeMode !== 'automation') {
    throw browserError('BROWSER_BUSY', 'Otra operación está utilizando el navegador.', false);
  }

  await closeActiveContext();
  activeMode = 'automation';
  try {
    activeContext = await launchWithRecovery(
      { ...baseOptions(), ...options },
      { allowHeadlessFallback: true }
    );
    activeBrowserVersion = activeContext.browser()?.version() || '';
    watchContext(activeContext);
    return activeContext;
  } catch (error) {
    activeMode = '';
    throw error;
  }
}

export async function openInteractiveBrowser(url) {
  if (activeMode === 'automation') {
    throw browserError('BROWSER_BUSY', 'Hay una automatización en curso. Inténtalo de nuevo cuando termine.', false);
  }

  if (!activeContext) {
    activeMode = 'interactive';
    try {
      activeContext = await launchWithRecovery({ ...baseOptions(), headless: false });
      activeBrowserVersion = activeContext.browser()?.version() || '';
      watchContext(activeContext);
    } catch (error) {
      activeMode = '';
      throw error;
    }
  }

  const page = activeContext.pages()[0] || await activeContext.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  return page;
}

export async function closeInteractiveBrowser() {
  if (activeMode !== 'interactive') return false;
  await closeActiveContext();
  return true;
}

export function browserManagerState() {
  return {
    mode: activeMode || 'idle',
    active: Boolean(activeContext),
    engine: 'chromium',
    version: activeBrowserVersion
  };
}

export async function shutdownBrowser() {
  await closeActiveContext();
}

export async function abortAutomationBrowser() {
  if (activeMode !== 'automation') return false;
  await closeActiveContext();
  return true;
}

export function normalizeBrowserError(error) {
  const text = error?.message || String(error);
  if (/\bPage crashed\b|Target crashed|page\.waitForTimeout: Page crashed/i.test(text)) {
    const normalized = browserError(
      'BROWSER_CRASHED',
      'La pestaña de Chromium se cerró inesperadamente durante la ejecución.',
      false,
      text
    );
    normalized.silentRetry = true;
    return normalized;
  }
  if (error?.code) return error;
  if (isDisplayError(error)) {
    return browserError(
      'DISPLAY_UNAVAILABLE',
      'La pantalla virtual del navegador no estaba disponible.',
      false,
      text
    );
  }
  if (isProfileLockError(error)) {
    return browserError(
      'BROWSER_PROFILE_LOCKED',
      'Chromium no pudo iniciar porque el perfil de sesión estaba bloqueado.',
      true,
      text
    );
  }
  if (/Target page, context or browser has been closed|browser.*closed/i.test(text)) {
    return browserError(
      'BROWSER_CLOSED',
      'Chromium se cerró de forma inesperada durante la ejecución.',
      true,
      text
    );
  }
  return error;
}

async function launchWithRecovery(options, behavior = {}) {
  const preflightRecovery = await recoverBrowserProfile();
  if (!preflightRecovery.recovered) {
    const error = browserError(
      'BROWSER_PROFILE_LOCKED',
      'Chromium no pudo iniciar porque el perfil de sesión seguía siendo utilizado por otro proceso.',
      true,
      `Procesos que siguen usando el perfil: ${preflightRecovery.remainingProcesses.join(', ')}`
    );
    error.recovery = preflightRecovery;
    throw error;
  }

  try {
    return await chromium.launchPersistentContext(chromiumSessionDir(), options);
  } catch (error) {
    if (behavior.allowHeadlessFallback && isDisplayError(error)) {
      await recoverBrowserProfile();
      try {
        return await chromium.launchPersistentContext(chromiumSessionDir(), {
          ...options,
          headless: true
        });
      } catch (headlessError) {
        throw normalizeBrowserError(headlessError);
      }
    }
    if (!isProfileLockError(error)) throw normalizeBrowserError(error);

    const recovery = await recoverBrowserProfile();
    if (!recovery.recovered) throw normalizeBrowserError(error);

    try {
      return await chromium.launchPersistentContext(chromiumSessionDir(), options);
    } catch (retryError) {
      const normalized = normalizeBrowserError(retryError);
      normalized.recovery = recovery;
      throw normalized;
    }
  }
}

async function recoverBrowserProfile() {
  const processes = await findProfileChromiumProcesses();
  for (const pid of processes) {
    await terminateProcess(pid);
  }

  const remaining = await findProfileChromiumProcesses();
  if (remaining.length) {
    return { recovered: false, terminatedProcesses: processes, remainingProcesses: remaining, removedLocks: [] };
  }

  const removedLocks = [];
  for (const filename of PROFILE_LOCK_FILES) {
    const lockPath = path.join(chromiumSessionDir(), filename);
    try {
      await fs.unlink(lockPath);
      removedLocks.push(filename);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  return { recovered: true, terminatedProcesses: processes, remainingProcesses: [], removedLocks };
}

async function findProfileChromiumProcesses() {
  if (process.platform !== 'linux') return [];
  const entries = await fs.readdir('/proc', { withFileTypes: true }).catch(() => []);
  const profile = chromiumSessionDir();
  const matches = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
    const cmdline = await fs.readFile(`/proc/${entry.name}/cmdline`, 'utf8').catch(() => '');
    if (/(?:chrome|chromium)/i.test(cmdline) && cmdline.includes(profile)) {
      matches.push(Number(entry.name));
    }
  }
  return matches;
}

async function terminateProcess(pid) {
  try {
    process.kill(pid, 'SIGTERM');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
    return;
  }

  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return;
    await delay(100);
  }

  try {
    process.kill(pid, 'SIGKILL');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function closeActiveContext() {
  const context = activeContext;
  activeContext = null;
  activeMode = '';
  activeBrowserVersion = '';
  if (context) await context.close().catch(() => {});
}

async function assertAuthenticatedSession(context) {
  const page = context.pages()[0] || await context.newPage();
  try {
    await navigateToCrealityPage(page, SESSION_CHECK_URL, {
      timeout: 30000,
      attempts: 2
    });
  } catch (error) {
    if (isNavigationTimeout(error) || error.code === 'NAVIGATION_TARGET_MISMATCH') {
      throw sessionCheckUnavailableError(error, page.url());
    }
    throw error;
  }
  await page.waitForTimeout(750);
  const diagnostic = await inspectCrealityPage(page, null);
  if (!diagnostic || ![
    'LOGIN_REQUIRED',
    'SECURITY_CHALLENGE'
  ].includes(diagnostic.code)) return;

  const error = new Error(diagnostic.message);
  error.code = diagnostic.code;
  error.systemic = true;
  error.diagnostic = diagnostic;
  throw error;
}

export function sessionCheckUnavailableError(error, currentUrl = '') {
  const technical = [
    error?.message || String(error),
    `Página final: ${currentUrl || 'desconocida'}.`,
    'La sesión no se ha considerado cerrada porque Creality Cloud no llegó a responder.'
  ].join(' ');
  const normalized = browserError(
    'SESSION_CHECK_UNAVAILABLE',
    'Creality Cloud no respondió al comprobar la sesión.',
    false,
    technical
  );
  normalized.silentRetry = true;
  return normalized;
}

function watchContext(context) {
  context.once('close', () => {
    if (activeContext !== context) return;
    activeContext = null;
    activeMode = '';
    activeBrowserVersion = '';
  });
}

function baseOptions() {
  const locale = process.env.CCTOOLS_BROWSER_LOCALE || 'es-ES';
  return {
    headless: false,
    viewport: { width: 1366, height: 768 },
    screen: { width: 1366, height: 768 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    acceptDownloads: true,
    timeout: 45000,
    locale,
    timezoneId: process.env.TZ || 'Europe/Madrid',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    env: { ...process.env }
  };
}

function isProfileLockError(error) {
  return /already running|profile(?: directory)? (?:is |appears to be )?(?:in use|locked)|ProcessSingleton|SingletonLock|user data directory is already in use/i.test(error?.message || '');
}

function isDisplayError(error) {
  return /without having an? XServer|Missing X server|Missing X server or \$DISPLAY|ozone_platform_x11.*Missing X server/i.test(error?.message || '');
}

function chromiumSessionDir() {
  return path.join(browserSessionDir(), 'chromium');
}

function browserError(code, message, systemic, technical = '') {
  const error = new Error(message);
  error.code = code;
  error.systemic = systemic;
  error.technical = technical;
  return error;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
